package desktop

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/coder/websocket"
)

type fakeStream struct {
	in   [][]byte
	sent [][]byte
}

func TestSSHStreamKeepsControlAndTerminalFramesDistinct(t *testing.T) {
	stream := &fakeStream{in: [][]byte{{frameText, '{', '}'}, {frameBinary, 'x'}}}
	viewer := &streamViewer{conn: stream}
	kind, payload, err := viewer.Read(context.Background())
	if err != nil || kind != websocket.MessageText || string(payload) != "{}" {
		t.Fatalf("control frame: %v, %q, %v", kind, payload, err)
	}
	kind, payload, err = viewer.Read(context.Background())
	if err != nil || kind != websocket.MessageBinary || string(payload) != "x" {
		t.Fatalf("terminal frame: %v, %q, %v", kind, payload, err)
	}
	if err := viewer.Write(context.Background(), websocket.MessageText, []byte("ready")); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stream.sent[0], append([]byte{frameText}, []byte("ready")...)) {
		t.Fatalf("outbound control frame: %v", stream.sent[0])
	}
}

func (f *fakeStream) Context() context.Context { return context.Background() }
func (f *fakeStream) Close() error             { return nil }
func (f *fakeStream) Receive() ([]byte, error) {
	if len(f.in) == 0 {
		return nil, io.EOF
	}
	frame := f.in[0]
	f.in = f.in[1:]
	return frame, nil
}
func (f *fakeStream) Send(frame []byte) error {
	f.sent = append(f.sent, bytes.Clone(frame))
	return nil
}

func TestVNCStreamAdapterCarriesContinuousBytes(t *testing.T) {
	stream := &fakeStream{in: [][]byte{{frameBinary, 'a', 'b', 'c'}, {frameBinary, 'd'}}}
	conn := (&streamViewer{conn: stream}).BinaryConn(context.Background())
	first := make([]byte, 2)
	if n, err := conn.Read(first); err != nil || n != 2 || string(first) != "ab" {
		t.Fatalf("first read: %q, %d, %v", first, n, err)
	}
	second := make([]byte, 2)
	if n, err := conn.Read(second); err != nil || n != 1 || string(second[:n]) != "c" {
		t.Fatalf("second read: %q, %d, %v", second, n, err)
	}
	if n, err := conn.Read(second); err != nil || n != 1 || string(second[:n]) != "d" {
		t.Fatalf("third read: %q, %d, %v", second, n, err)
	}
	if n, err := conn.Write([]byte("ok")); err != nil || n != 2 {
		t.Fatalf("write: %d, %v", n, err)
	}
	if len(stream.sent) != 1 || !bytes.Equal(stream.sent[0], []byte{frameBinary, 'o', 'k'}) {
		t.Fatalf("unexpected outbound frames: %v", stream.sent)
	}
}
