package remote

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/coder/websocket"
)

const (
	rfbClientSetPixelFormat           = 0
	rfbClientSetEncodings             = 2
	rfbClientFramebufferUpdateRequest = 3
	rfbClientKeyEvent                 = 4
	rfbClientPointerEvent             = 5
	rfbClientCutText                  = 6
	rfbServerFramebufferUpdate        = 0
	rfbServerSetColorMapEntries       = 1
	rfbServerBell                     = 2
	rfbServerCutText                  = 3
	rfbUltraFileMessage               = 7
	rfbTightFileMessagePrefix         = 0xfc
	rfbSecurityNone                   = 1
	rfbSecurityVNCAuth                = 2
	rfbSecurityTight                  = 16
	rfbSecurityUltraVNC               = 17
	maxVNCRequestedEncodings          = 256
	maxVNCClipboardBytes              = 1 << 20
	maxVNCCursorBytes                 = 16 << 20
	rfbPixelFormatBodyBytes           = 19
	rfbFrameRequestBodyBytes          = 9
	rfbKeyEventBodyBytes              = 7
	rfbPointerEventBodyBytes          = 5
	rfbCopyRectBodyBytes              = 4
	rfbColorMapEntryBytes             = 6
	vncReaderShutdownWait             = 2 * time.Second
	vncFileReplyTimeout               = 30 * time.Second
	vncUltraReplyQueueSize            = 64
)

const (
	rfbEncodingRaw         int32  = 0
	rfbEncodingCopyRect    int32  = 1
	rfbEncodingHextile     int32  = 5
	rfbEncodingZlib        int32  = 6
	rfbEncodingTight       int32  = 7
	rfbEncodingZRLE        int32  = 16
	rfbEncodingDesktopSize int32  = -223
	rfbEncodingLastRect    int32  = -224
	rfbEncodingRichCursor  int32  = -239
	rfbEncodingFTVersion   uint32 = 0xffff8002
)

type VNCBridge struct {
	upstream net.Conn
	reader   *bufio.Reader
	init     vncInit
	encoding string
	readOnly bool

	writeMu         sync.Mutex
	operationMu     sync.Mutex
	replies         chan ftReply
	ultraReplies    chan ultraReply
	ultraVersion    atomic.Uint32
	ultraBlockSize  atomic.Uint32
	ultraReady      chan struct{}
	ultraReadyOnce  sync.Once
	ultraAccessOnce sync.Once
	ultraAccessErr  error
	done            chan struct{}
	readerErr       error
	pixelBits       atomic.Uint32
	startOnce       sync.Once
	closeOnce       sync.Once
}

// NewVNCBridge authenticates upstream and prepares one multiplexed RFB connection.
func NewVNCBridge(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (*VNCBridge, error) {
	upstream, err := DialConnection(ctx, connection, secret, Address(connection), timeout)
	if err != nil {
		return nil, err
	}
	bridge, err := newVNCBridgeFromConn(upstream, secret.Password, timeout)
	if err != nil {
		return nil, err
	}
	bridge.encoding = connection.VNCEncoding
	bridge.readOnly = connection.VNCReadOnly
	return bridge, nil
}

// newVNCBridgeFromConn completes the upstream handshake on an established socket.
func newVNCBridgeFromConn(upstream net.Conn, password string, timeout time.Duration) (*VNCBridge, error) {
	if err := upstream.SetDeadline(time.Now().Add(timeout)); err != nil {
		upstream.Close()
		return nil, err
	}
	reader := bufio.NewReader(upstream)
	init, err := authenticateVNC(upstream, reader, password)
	if err != nil {
		upstream.Close()
		return nil, err
	}
	_ = upstream.SetDeadline(time.Time{})
	bridge := &VNCBridge{
		upstream:     upstream,
		reader:       reader,
		init:         init,
		replies:      make(chan ftReply, 8),
		ultraReplies: make(chan ultraReply, vncUltraReplyQueueSize),
		ultraReady:   make(chan struct{}),
		done:         make(chan struct{}),
	}
	bridge.pixelBits.Store(uint32(init.pixelBits))
	return bridge, nil
}

// Serve bridges one browser to the upstream RFB connection for its lifetime.
func (b *VNCBridge) Serve(ctx context.Context, socket *websocket.Conn, onReceive, onSend func(int), onReady func()) error {
	defer b.Close()
	downstream := websocket.NetConn(ctx, socket, websocket.MessageBinary)
	defer downstream.Close()
	if err := b.initBrowser(downstream); err != nil {
		return err
	}
	var display io.Writer = downstream
	if onSend != nil {
		display = observedWriter{writer: downstream, observe: onSend}
	}
	b.startReader(display)
	if !b.supportsTightFiles() {
		if err := b.writeUpstream(ultraEncodingMessage()); err != nil {
			return err
		}
	}
	if onReady != nil {
		onReady()
	}
	clientDone := make(chan error, 1)
	go func() {
		clientDone <- b.readBrowser(downstream, onReceive)
	}()
	select {
	case <-b.done:
		return b.readerErr
	case err := <-clientDone:
		return err
	case <-ctx.Done():
		_ = downstream.Close()
		select {
		case <-clientDone:
		case <-time.After(vncReaderShutdownWait):
		}
		return ctx.Err()
	}
}

// StartHeadless allows file operations when no desktop WebSocket is open.
func (b *VNCBridge) StartHeadless() error {
	b.startReader(io.Discard)
	if !b.supportsTightFiles() {
		return b.writeUpstream(ultraEncodingMessage())
	}
	return nil
}

// Close ends the upstream RFB connection and any pending file operation.
func (b *VNCBridge) Close() error {
	var err error
	b.closeOnce.Do(func() {
		err = b.upstream.Close()
	})
	return err
}

// SupportsFiles reports an advertised TightVNC or UltraVNC file protocol.
func (b *VNCBridge) SupportsFiles() bool {
	return b.supportsTightFiles() || b.ultraVersion.Load() > 0
}

func (b *VNCBridge) supportsTightFiles() bool {
	return b.hasCaps(ftListRequest, ftListReply)
}

// startReader runs the single upstream parser that separates display and file replies.
func (b *VNCBridge) startReader(display io.Writer) {
	b.startOnce.Do(func() {
		go func() {
			b.readerErr = b.readServer(display)
			close(b.done)
		}()
	})
}

// initBrowser presents a no-auth RFB 3.8 stream to an authenticated browser.
func (b *VNCBridge) initBrowser(downstream net.Conn) error {
	if _, err := downstream.Write([]byte("RFB 003.008\n")); err != nil {
		return err
	}
	var version [rfbVersionBytes]byte
	if _, err := io.ReadFull(downstream, version[:]); err != nil {
		return err
	}
	if string(version[:4]) != "RFB " {
		return vncProtocolError("invalid browser protocol version")
	}
	if _, err := downstream.Write([]byte{1, rfbSecurityNone}); err != nil {
		return err
	}
	var selected [1]byte
	if _, err := io.ReadFull(downstream, selected[:]); err != nil {
		return err
	}
	if selected[0] != rfbSecurityNone {
		return vncProtocolError("browser declined no-auth proxy stream")
	}
	if _, err := downstream.Write([]byte{0, 0, 0, 0}); err != nil {
		return err
	}
	var shared [1]byte
	if _, err := io.ReadFull(downstream, shared[:]); err != nil {
		return err
	}
	_, err := downstream.Write(b.init.serverInit)
	return err
}

// readBrowser validates client messages and limits framebuffer encodings.
func (b *VNCBridge) readBrowser(downstream net.Conn, onReceive func(int)) error {
	firstFrameRequest := true
	for {
		var kind [1]byte
		if _, err := io.ReadFull(downstream, kind[:]); err != nil {
			return err
		}
		var message []byte
		switch kind[0] {
		case rfbClientSetPixelFormat:
			body := make([]byte, rfbPixelFormatBodyBytes)
			if _, err := io.ReadFull(downstream, body); err != nil {
				return err
			}
			if body[3] != 8 && body[3] != 16 && body[3] != 32 {
				return vncProtocolError("invalid pixel depth")
			}
			b.pixelBits.Store(uint32(body[3]))
			message = append(kind[:], body...)
		case rfbClientSetEncodings:
			var header [3]byte
			if _, err := io.ReadFull(downstream, header[:]); err != nil {
				return err
			}
			count := binary.BigEndian.Uint16(header[1:])
			if count > maxVNCRequestedEncodings {
				return vncProtocolError("too many requested encodings")
			}
			requested := make([]byte, int(count)*4)
			if _, err := io.ReadFull(downstream, requested); err != nil {
				return err
			}
			message = allowedEncodingMessage(requested, b.encoding)
			if !b.supportsTightFiles() {
				message = appendUltraEncoding(message)
			}
		case rfbClientFramebufferUpdateRequest, rfbClientKeyEvent, rfbClientPointerEvent:
			var size int
			switch kind[0] {
			case rfbClientFramebufferUpdateRequest:
				size = rfbFrameRequestBodyBytes
			case rfbClientKeyEvent:
				size = rfbKeyEventBodyBytes
			case rfbClientPointerEvent:
				size = rfbPointerEventBodyBytes
			}
			body := make([]byte, size)
			if _, err := io.ReadFull(downstream, body); err != nil {
				return err
			}
			message = append(kind[:], body...)
		case rfbClientCutText:
			var header [7]byte
			if _, err := io.ReadFull(downstream, header[:]); err != nil {
				return err
			}
			length := binary.BigEndian.Uint32(header[3:])
			if length > maxVNCClipboardBytes {
				return vncProtocolError("clipboard message too large")
			}
			body := make([]byte, length)
			if _, err := io.ReadFull(downstream, body); err != nil {
				return err
			}
			message = append(append(kind[:], header[:]...), body...)
		default:
			return vncProtocolError("unsupported browser message %d", kind[0])
		}
		if b.readOnly && (kind[0] == rfbClientKeyEvent ||
			kind[0] == rfbClientPointerEvent || kind[0] == rfbClientCutText) {
			// Read the full message first so later framebuffer requests stay framed.
			continue
		}
		if kind[0] == rfbClientFramebufferUpdateRequest {
			// The first update must be full: the proxy cannot rely on the browser's cache.
			if firstFrameRequest {
				message[1] = 0
				firstFrameRequest = false
			}
		}
		if err := b.writeUpstream(message); err != nil {
			return err
		}
		if onReceive != nil {
			onReceive(len(message))
		}
	}
}

// allowedEncodingMessage keeps only formats the upstream parser can frame.
func allowedEncodingMessage(requested []byte, preference string) []byte {
	requestedCodes := []int32{}
	for offset := 0; offset < len(requested); offset += 4 {
		code := int32(binary.BigEndian.Uint32(requested[offset : offset+4]))
		if supportedVNCEncoding(code) {
			requestedCodes = append(requestedCodes, code)
		}
	}
	selected := []int32{}
	if preference == "" || preference == "auto" {
		selected = requestedCodes
	} else {
		preferred := preferredVNCEncoding(preference)
		for _, code := range []int32{rfbEncodingCopyRect, preferred, rfbEncodingRaw} {
			if code == rfbEncodingCopyRect && preference == "raw" {
				continue
			}
			for _, offered := range requestedCodes {
				if offered == code && !containsEncoding(selected, code) {
					selected = append(selected, code)
					break
				}
			}
		}
		for _, code := range requestedCodes {
			if code < 0 {
				selected = append(selected, code)
			}
		}
	}
	if len(selected) == 0 {
		selected = append(selected, rfbEncodingRaw)
	}
	message := make([]byte, 4+4*len(selected))
	message[0] = rfbClientSetEncodings
	binary.BigEndian.PutUint16(message[2:4], uint16(len(selected)))
	for index, code := range selected {
		binary.BigEndian.PutUint32(message[4+index*4:], uint32(code))
	}
	return message
}

// supportedVNCEncoding only admits formats that readServer can frame safely.
func supportedVNCEncoding(code int32) bool {
	switch code {
	case rfbEncodingRaw, rfbEncodingCopyRect, rfbEncodingHextile,
		rfbEncodingZlib, rfbEncodingTight, rfbEncodingZRLE,
		rfbEncodingDesktopSize, rfbEncodingLastRect, rfbEncodingRichCursor:
		return true
	default:
		// TightVNC's compression and quality pseudo-encodings carry no rectangles.
		return (code >= -32 && code <= -23) || (code >= -256 && code <= -247)
	}
}

func preferredVNCEncoding(preference string) int32 {
	switch preference {
	case "copyrect":
		return rfbEncodingCopyRect
	case "tight":
		return rfbEncodingTight
	case "zlib":
		return rfbEncodingZlib
	case "hextile":
		return rfbEncodingHextile
	case "zrle":
		return rfbEncodingZRLE
	default:
		return rfbEncodingRaw
	}
}

func containsEncoding(codes []int32, target int32) bool {
	for _, code := range codes {
		if code == target {
			return true
		}
	}
	return false
}

// readServer routes display messages and each VNC file protocol separately.
func (b *VNCBridge) readServer(display io.Writer) error {
	for {
		kind, err := b.reader.ReadByte()
		if err != nil {
			return err
		}
		if kind == rfbTightFileMessagePrefix {
			var rest [3]byte
			if _, err := io.ReadFull(b.reader, rest[:]); err != nil {
				return err
			}
			code := uint32(kind)<<24 | uint32(rest[0])<<16 |
				uint32(rest[1])<<8 | uint32(rest[2])
			reply, err := readFTReply(b.reader, code)
			if err != nil {
				return err
			}
			b.replies <- reply
			continue
		}
		switch kind {
		case rfbUltraFileMessage:
			reply, err := readUltraReply(b.reader, b.ultraVersion.Load() == ultraLegacyVersion)
			if err != nil {
				return err
			}
			if reply.kind == ultraProtocolVersion {
				b.ultraVersion.Store(uint32(reply.param))
				if reply.size >= ultraMinBlockBytes && reply.size <= ultraMaxBlockBytes {
					b.ultraBlockSize.Store(reply.size)
				}
				b.ultraReadyOnce.Do(func() { close(b.ultraReady) })
				continue
			}
			b.ultraReplies <- reply
			continue
		case rfbServerFramebufferUpdate:
			if err := b.forwardFramebuffer(display); err != nil {
				return err
			}
		case rfbServerSetColorMapEntries:
			if err := b.forwardColorMap(display); err != nil {
				return err
			}
		case rfbServerBell:
			if _, err := display.Write([]byte{rfbServerBell}); err != nil {
				return err
			}
		case rfbServerCutText:
			if err := b.forwardClipboard(display); err != nil {
				return err
			}
		default:
			return vncProtocolError("unsupported server message %d", kind)
		}
	}
}

type observedWriter struct {
	writer  io.Writer
	observe func(int)
}

// Write forwards display bytes and updates the session's traffic counter.
func (w observedWriter) Write(data []byte) (int, error) {
	count, err := w.writer.Write(data)
	if count > 0 {
		w.observe(count)
	}
	return count, err
}

// forwardFramebuffer frames supported rectangles before forwarding them.
func (b *VNCBridge) forwardFramebuffer(display io.Writer) error {
	var header [3]byte
	if _, err := io.ReadFull(b.reader, header[:]); err != nil {
		return err
	}
	if _, err := display.Write(append([]byte{rfbServerFramebufferUpdate}, header[:]...)); err != nil {
		return err
	}
	count := binary.BigEndian.Uint16(header[1:])
	for index := 0; index < int(count); index++ {
		var rectangle [12]byte
		if _, err := io.ReadFull(b.reader, rectangle[:]); err != nil {
			return err
		}
		if _, err := display.Write(rectangle[:]); err != nil {
			return err
		}
		width := uint64(binary.BigEndian.Uint16(rectangle[4:6]))
		height := uint64(binary.BigEndian.Uint16(rectangle[6:8]))
		encoding := int32(binary.BigEndian.Uint32(rectangle[8:12]))
		switch encoding {
		case rfbEncodingRaw:
			size := width * height * uint64(b.pixelBits.Load()/8)
			if size > maxVNCRectangleBytes {
				return vncProtocolError("framebuffer rectangle too large")
			}
			if _, err := io.CopyN(display, b.reader, int64(size)); err != nil {
				return err
			}
		case rfbEncodingCopyRect:
			if _, err := io.CopyN(display, b.reader, rfbCopyRectBodyBytes); err != nil {
				return err
			}
		case rfbEncodingZlib, rfbEncodingZRLE:
			var sizeBytes [4]byte
			if _, err := io.ReadFull(b.reader, sizeBytes[:]); err != nil {
				return err
			}
			size := binary.BigEndian.Uint32(sizeBytes[:])
			if size > maxVNCRectangleBytes {
				return vncProtocolError("compressed rectangle too large")
			}
			if _, err := display.Write(sizeBytes[:]); err != nil {
				return err
			}
			if _, err := io.CopyN(display, b.reader, int64(size)); err != nil {
				return err
			}
		case rfbEncodingRichCursor:
			pixelBytes := width * height * uint64(b.pixelBits.Load()/8)
			maskBytes := ((width + 7) / 8) * height
			if pixelBytes+maskBytes > maxVNCCursorBytes {
				return vncProtocolError("cursor shape is too large")
			}
			if _, err := io.CopyN(display, b.reader, int64(pixelBytes+maskBytes)); err != nil {
				return err
			}
		case rfbEncodingDesktopSize:
		case rfbEncodingLastRect:
			return nil
		case rfbEncodingHextile:
			if err := b.forwardHextile(display, width, height); err != nil {
				return err
			}
		case rfbEncodingTight:
			if err := b.forwardTight(display, width, height); err != nil {
				return err
			}
		default:
			return vncProtocolError("unnegotiated framebuffer encoding %d", encoding)
		}
	}
	return nil
}

// forwardColorMap forwards a bounded RFB color-map update.
func (b *VNCBridge) forwardColorMap(display io.Writer) error {
	var header [5]byte
	if _, err := io.ReadFull(b.reader, header[:]); err != nil {
		return err
	}
	count := binary.BigEndian.Uint16(header[3:])
	if _, err := display.Write(append([]byte{rfbServerSetColorMapEntries}, header[:]...)); err != nil {
		return err
	}
	_, err := io.CopyN(display, b.reader, int64(count)*rfbColorMapEntryBytes)
	return err
}

// forwardClipboard forwards a bounded server clipboard message.
func (b *VNCBridge) forwardClipboard(display io.Writer) error {
	var header [7]byte
	if _, err := io.ReadFull(b.reader, header[:]); err != nil {
		return err
	}
	length := binary.BigEndian.Uint32(header[3:])
	if length > maxVNCClipboardBytes {
		return vncProtocolError("server clipboard message too large")
	}
	if _, err := display.Write(append([]byte{rfbServerCutText}, header[:]...)); err != nil {
		return err
	}
	_, err := io.CopyN(display, b.reader, int64(length))
	return err
}

// writeUpstream serializes browser input and TightVNC file requests.
func (b *VNCBridge) writeUpstream(message []byte) error {
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	for len(message) > 0 {
		count, err := b.upstream.Write(message)
		if err != nil {
			return err
		}
		message = message[count:]
	}
	return nil
}

// awaitReply waits for one expected TightVNC file response.
func (b *VNCBridge) awaitReply(expected uint32) (ftReply, error) {
	return b.awaitOneOf(expected)
}

// awaitOneOf accepts alternate download responses and closes a desynced stream.
func (b *VNCBridge) awaitOneOf(expected ...uint32) (ftReply, error) {
	// A server may close immediately after writing its final reply. Consume
	// buffered replies before treating the closed stream as the result.
	select {
	case reply := <-b.replies:
		return b.checkReply(reply, expected)
	default:
	}

	select {
	case reply := <-b.replies:
		return b.checkReply(reply, expected)
	case <-b.done:
		select {
		case reply := <-b.replies:
			return b.checkReply(reply, expected)
		default:
		}
		if b.readerErr == nil {
			return ftReply{}, errors.New("VNC file channel closed")
		}
		return ftReply{}, fmt.Errorf("VNC file channel closed: %w", b.readerErr)
	case <-time.After(vncFileReplyTimeout):
		b.Close()
		return ftReply{}, errors.New("TightVNC file operation timed out")
	}
}

// checkReply validates a file response against the active request.
func (b *VNCBridge) checkReply(reply ftReply, expected []uint32) (ftReply, error) {
	if reply.code == ftFailedReply {
		return reply, errors.New(string(reply.body))
	}
	for _, code := range expected {
		if reply.code == code {
			return reply, nil
		}
	}
	b.Close()
	return reply, vncProtocolError("unexpected file reply %08x", reply.code)
}
