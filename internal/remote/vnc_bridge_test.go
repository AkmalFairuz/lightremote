package remote

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func TestRichCursorRectangleIsForwarded(t *testing.T) {
	rectangle := []byte{
		0, 0, 0, 0, 0, 1, 0, 1,
		0xff, 0xff, 0xff, 0x11,
	}
	frame := append([]byte{0, 0, 1}, rectangle...)
	frame = append(frame, 1, 2, 3, 4, 0x80)
	bridge := &VNCBridge{reader: bufio.NewReader(bytes.NewReader(frame))}
	bridge.pixelBits.Store(32)
	var display bytes.Buffer
	if err := bridge.forwardFramebuffer(&display); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(display.Bytes(), append([]byte{0}, frame...)) {
		t.Fatal("rich cursor rectangle was not forwarded intact")
	}
	if !bytes.Equal(allowedEncodingMessage([]byte{0xff, 0xff, 0xff, 0x11}, "auto")[4:], []byte{0xff, 0xff, 0xff, 0x11}) {
		t.Fatal("rich cursor encoding was not offered upstream")
	}
}

func TestVNCEncodingPreference(t *testing.T) {
	requested := []byte{}
	for _, code := range []int32{1, 0, 7, 16, 5, 6, -223, -239} {
		requested = binary.BigEndian.AppendUint32(requested, uint32(code))
	}
	for _, example := range []struct {
		preference string
		want       []int32
	}{
		{"auto", []int32{1, 0, 7, 16, 5, 6, -223, -239}},
		{"copyrect", []int32{1, 0, -223, -239}},
		{"tight", []int32{1, 7, 0, -223, -239}},
		{"zrle", []int32{1, 16, 0, -223, -239}},
		{"hextile", []int32{1, 5, 0, -223, -239}},
		{"zlib", []int32{1, 6, 0, -223, -239}},
		{"raw", []int32{0, -223, -239}},
	} {
		message := allowedEncodingMessage(requested, example.preference)
		if count := binary.BigEndian.Uint16(message[2:4]); int(count) != len(example.want) {
			t.Fatalf("%s: offered %d encodings, want %d", example.preference, count, len(example.want))
		}
		for index, want := range example.want {
			got := int32(binary.BigEndian.Uint32(message[4+4*index:]))
			if got != want {
				t.Fatalf("%s: encoding %d is %d, want %d", example.preference, index, got, want)
			}
		}
	}
}

func TestVNCFramebufferFormatsAreFramed(t *testing.T) {
	for _, example := range []struct {
		name     string
		encoding int32
		payload  []byte
	}{
		{"hextile", 5, []byte{1, 1, 2, 3, 4}},
		{"zlib", 6, []byte{0, 0, 0, 2, 0xaa, 0xbb}},
		{"tight fill", 7, []byte{0x80, 1, 2, 3}},
		{"tight jpeg", 7, []byte{0x90, 2, 0xaa, 0xbb}},
		{"tight palette", 7, []byte{0x40, 1, 1, 0, 0, 0, 255, 255, 255, 0x80}},
	} {
		t.Run(example.name, func(t *testing.T) {
			rectangle := make([]byte, 12)
			binary.BigEndian.PutUint16(rectangle[4:6], 1)
			binary.BigEndian.PutUint16(rectangle[6:8], 1)
			binary.BigEndian.PutUint32(rectangle[8:12], uint32(example.encoding))
			frame := append([]byte{0, 0, 1}, rectangle...)
			frame = append(frame, example.payload...)
			bridge := &VNCBridge{reader: bufio.NewReader(bytes.NewReader(append(frame, 0xfc)))}
			bridge.pixelBits.Store(32)
			var display bytes.Buffer
			if err := bridge.forwardFramebuffer(&display); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(display.Bytes(), append([]byte{0}, frame...)) {
				t.Fatal("framebuffer payload changed")
			}
			next, err := bridge.reader.ReadByte()
			if err != nil || next != 0xfc {
				t.Fatal("framebuffer parser consumed the following file reply")
			}
		})
	}
}

func TestEightBitRawFrameIsForwardedUnchanged(t *testing.T) {
	rectangle := make([]byte, 12)
	binary.BigEndian.PutUint16(rectangle[4:6], 2)
	binary.BigEndian.PutUint16(rectangle[6:8], 1)
	frame := append([]byte{0, 0, 1}, rectangle...)
	frame = append(frame, 0x07, 0xc0)
	bridge := &VNCBridge{reader: bufio.NewReader(bytes.NewReader(frame))}
	bridge.pixelBits.Store(8)
	var display bytes.Buffer
	if err := bridge.forwardFramebuffer(&display); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(display.Bytes(), append([]byte{0}, frame...)) {
		t.Fatal("8-bit framebuffer data was changed")
	}
}

func TestTightFileListWhileDisplayUpdates(t *testing.T) {
	clientSocket, serverSocket := net.Pipe()
	defer clientSocket.Close()
	defer serverSocket.Close()

	serverDone := make(chan error, 1)
	go func() {
		serverDone <- serveTightFixture(serverSocket)
	}()

	bridge, err := newVNCBridgeFromConn(clientSocket, "", 5*time.Second)
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}
	defer bridge.Close()
	if !bridge.SupportsFiles() {
		t.Fatal("file-transfer capability was not negotiated")
	}
	if err := bridge.StartHeadless(); err != nil {
		t.Fatal(err)
	}

	entries, err := bridge.Files(false).List("/")
	if err != nil {
		t.Fatalf("file list after framebuffer update: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "report.txt" || entries[0].Size != 7 {
		t.Fatalf("unexpected file list: %+v", entries)
	}
	if err := <-serverDone; err != nil {
		t.Fatalf("fixture server: %v", err)
	}
}

func serveTightFixture(conn net.Conn) error {
	if _, err := conn.Write([]byte("RFB 003.008\n")); err != nil {
		return err
	}
	if _, err := io.CopyN(io.Discard, conn, 12); err != nil {
		return err
	}
	if _, err := conn.Write([]byte{1, 16}); err != nil {
		return err
	}
	var selected [1]byte
	if _, err := io.ReadFull(conn, selected[:]); err != nil {
		return err
	}
	if selected[0] != 16 {
		return vncProtocolError("fixture expected Tight security")
	}
	if err := binary.Write(conn, binary.BigEndian, uint32(0)); err != nil {
		return err
	}
	if err := binary.Write(conn, binary.BigEndian, uint32(0)); err != nil {
		return err
	}
	if err := binary.Write(conn, binary.BigEndian, uint32(0)); err != nil {
		return err
	}
	if _, err := io.CopyN(io.Discard, conn, 1); err != nil {
		return err
	}
	init := make([]byte, 24)
	binary.BigEndian.PutUint16(init[0:2], 1)
	binary.BigEndian.PutUint16(init[2:4], 1)
	init[4] = 32
	init[5] = 24
	init[7] = 1
	if _, err := conn.Write(init); err != nil {
		return err
	}
	capHeader := []byte{0, 1, 0, 1, 0, 0, 0, 0}
	if _, err := conn.Write(capHeader); err != nil {
		return err
	}
	if err := writeFixtureCapability(conn, ftListReply, "FTSFLRLY"); err != nil {
		return err
	}
	if err := writeFixtureCapability(conn, ftListRequest, "FTCFLRST"); err != nil {
		return err
	}

	var requestHeader [9]byte
	if _, err := io.ReadFull(conn, requestHeader[:]); err != nil {
		return err
	}
	if binary.BigEndian.Uint32(requestHeader[:4]) != ftListRequest {
		return vncProtocolError("fixture expected file-list request")
	}
	length := binary.BigEndian.Uint32(requestHeader[5:9])
	if length != 2 {
		return vncProtocolError("fixture expected root path")
	}
	rootPath := make([]byte, length)
	if _, err := io.ReadFull(conn, rootPath); err != nil {
		return err
	}
	if string(rootPath) != "/\x00" {
		return vncProtocolError("fixture expected a NUL-terminated root path")
	}

	frame := []byte{
		0, 0, 0, 1,
		0, 0, 0, 0, 0, 1, 0, 1,
		0, 0, 0, 0,
		1, 2, 3, 4,
	}
	if _, err := conn.Write(frame); err != nil {
		return err
	}
	body := binary.BigEndian.AppendUint32(nil, 1)
	body = binary.BigEndian.AppendUint64(body, 7)
	body = binary.BigEndian.AppendUint64(body, uint64(time.Now().UnixMilli()))
	body = binary.BigEndian.AppendUint16(body, 0)
	body = appendFTString(body, "report.txt")
	reply := makeFTRequest(ftListReply, 0)
	reply = binary.BigEndian.AppendUint32(reply, uint32(len(body)))
	reply = binary.BigEndian.AppendUint32(reply, uint32(len(body)))
	reply = append(reply, body...)
	_, err := conn.Write(reply)
	return err
}

func writeFixtureCapability(conn net.Conn, code uint32, signature string) error {
	capability := binary.BigEndian.AppendUint32(nil, code)
	capability = append(capability, []byte("TGHT")...)
	capability = append(capability, []byte(signature)...)
	_, err := conn.Write(capability)
	return err
}
