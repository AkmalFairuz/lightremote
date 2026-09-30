package remote

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"testing"
	"time"
)

// Exercise the changed chunk-size behavior with a server limit below the default.
func TestUltraUploadRespectsNegotiatedBlockSize(t *testing.T) {
	payload := bytes.Repeat([]byte{0, 255, 1, 128, 42}, 2000)
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	_ = server.SetDeadline(time.Now().Add(5 * time.Second))
	b := &VNCBridge{
		upstream: client, done: make(chan struct{}),
		ultraReplies: make(chan ultraReply, 1),
	}
	b.ultraVersion.Store(ultraUnicodeVersion)
	b.ultraBlockSize.Store(ultraMinBlockBytes)
	result := make(chan error, 1)
	go func() {
		result <- receiveUltraUpload(server, b, payload)
		server.Close()
		close(b.done)
	}()
	err := (&ultraVNCFiles{bridge: b}).Upload("C:/upload.bin", bytes.NewReader(payload), nil)
	peerErr := <-result
	if err != nil || peerErr != nil {
		t.Fatalf("upload: %v; peer: %v", err, peerErr)
	}
}

func receiveUltraUpload(conn net.Conn, b *VNCBridge, want []byte) error {
	var got []byte
	started, offered, ended := false, false, false
	for {
		var header [12]byte
		if _, err := io.ReadFull(conn, header[:]); err != nil {
			return err
		}
		length := binary.BigEndian.Uint32(header[8:])
		if header[0] != 7 || length > ultraMinBlockBytes {
			return fmt.Errorf("invalid message or oversized payload %d", length)
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(conn, body); err != nil {
			return err
		}
		switch header[1] {
		case ultraSessionStart:
			if started {
				return fmt.Errorf("duplicate session start")
			}
			started = true
		case ultraFileOffer:
			if !started || offered || string(body) != "C:\\upload.bin" || binary.BigEndian.Uint32(header[4:8]) != uint32(len(want)) {
				return fmt.Errorf("invalid offer")
			}
			offered = true
			var high uint32
			if err := binary.Read(conn, binary.BigEndian, &high); err != nil {
				return err
			}
			if high != 0 {
				return fmt.Errorf("incorrect high size word")
			}
			b.ultraReplies <- ultraReply{kind: ultraChecksums, data: []byte{1, 2, 3, 4}}
			b.ultraReplies <- ultraReply{kind: ultraFileAccept}
		case ultraFilePacket:
			if !offered || ended || length == 0 || binary.BigEndian.Uint32(header[4:8]) != 0 {
				return fmt.Errorf("invalid data packet")
			}
			got = append(got, body...)
		case ultraEndFile:
			if !offered || ended || length != 0 || !bytes.Equal(got, want) {
				return fmt.Errorf("invalid completion or contents: got %d bytes, want %d", len(got), len(want))
			}
			ended = true
		case ultraSessionEnd:
			if !ended {
				return fmt.Errorf("session ended before upload")
			}
			return nil
		default:
			return fmt.Errorf("unexpected message %d", header[1])
		}
	}
}
