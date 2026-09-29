package remote

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/model"
)

// These message and parameter values come from UltraVNC's rfbproto.h.
const (
	ultraDirRequest      = 1
	ultraDirPacket       = 2
	ultraFileRequest     = 3
	ultraFileHeader      = 4
	ultraFilePacket      = 5
	ultraEndFile         = 6
	ultraAbort           = 7
	ultraFileOffer       = 8
	ultraFileAccept      = 9
	ultraCommand         = 10
	ultraCommandReturn   = 11
	ultraChecksums       = 12
	ultraAccess          = 14
	ultraSessionStart    = 15
	ultraSessionEnd      = 16
	ultraProtocolVersion = 17

	ultraDirContents = 1
	ultraDrives      = 2
	ultraDirectory   = 1
	ultraFile        = 2
	ultraDriveList   = 3
	ultraDirCreated  = 4
	ultraFileDeleted = 7
	ultraFileRenamed = 8
	ultraDirDenied   = 18
	ultraUnicodeFlag = 0x8000

	ultraCreateDir = 1
	ultraDelete    = 4
	ultraRename    = 5

	ultraLegacyVersion  = 1
	ultraBaseVersion    = 2
	ultraSessionVersion = 3
	ultraUnicodeVersion = 4

	ultraHeaderBytes        = 12
	ultraFindDataNameOffset = 44
	ultraProbeWait          = 1200 * time.Millisecond
	ultraMaxPayload         = 16 << 20
	ultraMaxFileEntries     = 100_000
	ultraBlockBytes         = 32 * 1024
	ultraLegacyBlockBytes   = 8192
	ultraMinBlockBytes      = 4096
	ultraMaxBlockBytes      = 1 << 20
	winFileTimeUnixOffset   = 116444736000000000
)

type ultraReply struct {
	kind  byte
	param uint16
	size  uint32
	data  []byte
	high  uint32
}

func ultraPacket(kind byte, param uint16, size uint32, data []byte) []byte {
	packet := make([]byte, ultraHeaderBytes, ultraHeaderBytes+len(data))
	packet[0] = rfbUltraFileMessage
	packet[1] = kind
	// UltraVNC writes contentParam without swapping it on Windows.
	binary.LittleEndian.PutUint16(packet[2:4], param)
	binary.BigEndian.PutUint32(packet[4:8], size)
	binary.BigEndian.PutUint32(packet[8:12], uint32(len(data)))
	return append(packet, data...)
}

func ultraEncodingMessage() []byte {
	message := []byte{rfbClientSetEncodings, 0, 0, 2}
	message = binary.BigEndian.AppendUint32(message, uint32(rfbEncodingRaw))
	return binary.BigEndian.AppendUint32(message, rfbEncodingFTVersion)
}

func appendUltraEncoding(message []byte) []byte {
	count := binary.BigEndian.Uint16(message[2:4])
	binary.BigEndian.PutUint16(message[2:4], count+1)
	return binary.BigEndian.AppendUint32(message, rfbEncodingFTVersion)
}

// readUltraReply consumes precisely one server message, including the extra
// high file-size word after a file header. UltraVNC leaves unused header fields
// uninitialized in several control messages, so those fields are ignored.
func readUltraReply(reader *bufio.Reader, legacy bool) (ultraReply, error) {
	var header [ultraHeaderBytes - 1]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return ultraReply{}, err
	}
	reply := ultraReply{
		kind:  header[0],
		param: binary.LittleEndian.Uint16(header[1:3]),
		size:  binary.BigEndian.Uint32(header[3:7]),
	}
	switch reply.kind {
	case ultraProtocolVersion, ultraAccess, ultraAbort, ultraEndFile:
		return reply, nil
	}
	length := binary.BigEndian.Uint32(header[7:11])
	if length > ultraMaxPayload {
		return ultraReply{}, vncProtocolError("UltraVNC file payload is too large")
	}
	if reply.kind == ultraFilePacket && reply.size == 2 {
		// Delta-transfer skip packets have a byte count but no payload.
		return reply, nil
	}
	reply.data = make([]byte, length)
	if _, err := io.ReadFull(reader, reply.data); err != nil {
		return ultraReply{}, err
	}
	if reply.kind == ultraFileHeader && !legacy {
		var high [4]byte
		if _, err := io.ReadFull(reader, high[:]); err != nil {
			return ultraReply{}, err
		}
		reply.high = binary.BigEndian.Uint32(high[:])
	}
	return reply, nil
}

func (b *VNCBridge) enableUltraFiles() error {
	if b.ultraVersion.Load() == 0 {
		select {
		case <-b.ultraReady:
		case <-time.After(ultraProbeWait):
		case <-b.done:
			return ErrUnsupported
		}
	}
	serverName := strings.ToLower(b.init.serverName)
	if b.ultraVersion.Load() == 0 && !b.init.ultraOffered &&
		!strings.Contains(serverName, "winvnc") &&
		!strings.Contains(serverName, "ultravnc") {
		return ErrUnsupported
	}

	b.ultraAccessOnce.Do(func() {
		b.operationMu.Lock()
		defer b.operationMu.Unlock()
		// UltraVNC's viewer requests permission with Abort/contentParam 3.
		if err := b.writeUpstream(ultraPacket(ultraAbort, ultraSessionVersion, 0, nil)); err != nil {
			b.ultraAccessErr = err
			return
		}
		reply, err := b.awaitUltra(ultraAccess, ultraAbort)
		if err != nil {
			b.ultraAccessErr = err
			return
		}
		if reply.size != 1 {
			b.ultraAccessErr = errors.New("UltraVNC file transfer was denied by the server")
			return
		}
		if reply.kind == ultraAbort {
			b.ultraVersion.Store(ultraLegacyVersion)
		} else if b.ultraVersion.Load() == 0 {
			b.ultraVersion.Store(ultraBaseVersion)
		}
	})
	return b.ultraAccessErr
}

func (b *VNCBridge) startUltraSession() error {
	if b.ultraVersion.Load() < ultraSessionVersion {
		return nil
	}
	return b.writeUpstream(ultraPacket(ultraSessionStart, 0, 0, nil))
}

func (b *VNCBridge) endUltraSession() {
	if b.ultraVersion.Load() >= ultraSessionVersion {
		_ = b.writeUpstream(ultraPacket(ultraSessionEnd, 0, 0, nil))
	}
}

func (b *VNCBridge) awaitUltra(expected ...byte) (ultraReply, error) {
	select {
	case reply := <-b.ultraReplies:
		return b.checkUltra(reply, expected)
	default:
	}
	select {
	case reply := <-b.ultraReplies:
		return b.checkUltra(reply, expected)
	case <-b.done:
		return ultraReply{}, fmt.Errorf("UltraVNC file channel closed: %w", b.readerErr)
	case <-time.After(vncFileReplyTimeout):
		b.Close()
		return ultraReply{}, errors.New("UltraVNC file operation timed out")
	}
}

func (b *VNCBridge) checkUltra(reply ultraReply, expected []byte) (ultraReply, error) {
	for _, kind := range expected {
		if reply.kind == kind {
			return reply, nil
		}
	}
	b.Close()
	return ultraReply{}, vncProtocolError("unexpected UltraVNC file reply %d", reply.kind)
}

// Older servers interpret paths in their unknown local ANSI code page.
// ASCII is the only encoding we can send without guessing that code page.
func ultraWirePath(remotePath string, directory bool, version uint32) (string, error) {
	clean, err := CleanRemotePath(remotePath)
	if err != nil {
		return "", err
	}
	if clean == "/" {
		return "", errors.New("open a drive before accessing files")
	}
	if len(clean) < 3 || !isDriveLetter(clean[0]) || clean[1:3] != ":/" {
		return "", errors.New("UltraVNC requires a Windows drive path")
	}
	wirePath := strings.ReplaceAll(clean, "/", "\\")
	if directory && !strings.HasSuffix(wirePath, "\\") {
		wirePath += "\\"
	}
	if version < ultraUnicodeVersion {
		for _, character := range wirePath {
			if character > 127 {
				return "", errors.New("this UltraVNC server cannot safely encode non-ASCII paths")
			}
		}
	}
	return wirePath, nil
}

func ultraDriveEntries(data []byte) ([]model.FileEntry, error) {
	entries := []model.FileEntry{}
	for _, drive := range bytes.Split(data, []byte{0}) {
		if len(drive) == 0 {
			continue
		}
		if len(drive) < 2 || !isDriveLetter(drive[0]) || drive[1] != ':' {
			return nil, vncProtocolError("invalid UltraVNC drive entry")
		}
		name := string(drive[:2])
		entries = append(entries, model.FileEntry{Name: name, Path: name + "/", IsDir: true})
	}
	return entries, nil
}

func isUltraDirectoryHeader(data []byte) bool {
	return len(data) >= 3 && isDriveLetter(data[0]) && data[1] == ':' &&
		(data[2] == '\\' || data[2] == '/')
}

func ultraFileEntry(parent string, reply ultraReply) (model.FileEntry, error) {
	if len(reply.data) < ultraFindDataNameOffset+1 {
		return model.FileEntry{}, vncProtocolError("short UltraVNC file entry")
	}
	nameBytes := reply.data[ultraFindDataNameOffset:]
	var name string
	if reply.param&ultraUnicodeFlag != 0 {
		if len(nameBytes)%2 != 0 {
			return model.FileEntry{}, vncProtocolError("invalid UltraVNC Unicode filename")
		}
		units := make([]uint16, 0, len(nameBytes)/2)
		for offset := 0; offset < len(nameBytes); offset += 2 {
			unit := binary.LittleEndian.Uint16(nameBytes[offset:])
			if unit == 0 {
				break
			}
			units = append(units, unit)
		}
		name = string(utf16.Decode(units))
	} else {
		nameBytes = bytes.TrimRight(nameBytes, "\x00")
		if !utf8.Valid(nameBytes) {
			return model.FileEntry{}, errors.New("legacy UltraVNC filename uses an unknown ANSI code page")
		}
		name = string(nameBytes)
	}
	if name == "" || strings.ContainsAny(name, "/\\\x00") {
		return model.FileEntry{}, vncProtocolError("invalid UltraVNC filename")
	}
	size := uint64(binary.LittleEndian.Uint32(reply.data[28:32]))<<32 |
		uint64(binary.LittleEndian.Uint32(reply.data[32:36]))
	if size > uint64(^uint64(0)>>1) {
		return model.FileEntry{}, vncProtocolError("UltraVNC file is too large")
	}
	ticks := binary.LittleEndian.Uint64(reply.data[20:28])
	modified := time.Time{}
	if ticks >= winFileTimeUnixOffset {
		elapsed := ticks - winFileTimeUnixOffset
		modified = time.Unix(int64(elapsed/10_000_000), int64(elapsed%10_000_000)*100).UTC()
	}
	return model.FileEntry{
		Name:    name,
		Path:    strings.TrimSuffix(parent, "/") + "/" + name,
		Size:    int64(size),
		IsDir:   reply.param&^uint16(ultraUnicodeFlag) == ultraDirectory,
		ModTime: modified,
	}, nil
}
