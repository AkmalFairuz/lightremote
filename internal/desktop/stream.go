package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/httpapi"
	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	frameBinary byte = iota
	frameText
	frameClose
)

type streamHello struct {
	SessionID string `json:"sessionId"`
}

type streamConnection interface {
	Context() context.Context
	Receive() ([]byte, error)
	Send([]byte) error
	Close() error
}

// ServeViewer attaches a Wails stream to an existing local work session.
func ServeViewer(conn *application.StreamConn, work *httpapi.WorkHandler) {
	defer conn.Close()
	first, err := conn.Receive()
	if err != nil || len(first) > 1024 {
		return
	}
	var hello streamHello
	if json.Unmarshal(first, &hello) != nil || hello.SessionID == "" {
		return
	}
	if err := conn.Send(append([]byte{frameText}, []byte(`{"type":"attached"}`)...)); err != nil {
		return
	}
	work.ServeLocalViewer(conn.Context(), hello.SessionID, &streamViewer{conn: conn})
}

type streamViewer struct {
	conn streamConnection
}

func (v *streamViewer) Read(_ context.Context) (websocket.MessageType, []byte, error) {
	frame, err := v.conn.Receive()
	if err != nil {
		return 0, nil, err
	}
	if len(frame) == 0 {
		return 0, nil, errors.New("empty viewer frame")
	}
	switch frame[0] {
	case frameBinary:
		return websocket.MessageBinary, frame[1:], nil
	case frameText:
		return websocket.MessageText, frame[1:], nil
	default:
		return 0, nil, errors.New("invalid viewer frame")
	}
}

func (v *streamViewer) Write(_ context.Context, kind websocket.MessageType, payload []byte) error {
	header := frameBinary
	if kind == websocket.MessageText {
		header = frameText
	}
	frame := make([]byte, len(payload)+1)
	frame[0] = header
	copy(frame[1:], payload)
	return v.conn.Send(frame)
}

func (v *streamViewer) Close(_ websocket.StatusCode, reason string) error {
	if reason != "" {
		frame := append([]byte{frameClose}, []byte(reason)...)
		_ = v.conn.Send(frame)
	}
	return v.conn.Close()
}

func (v *streamViewer) CloseNow() error {
	return v.conn.Close()
}

func (v *streamViewer) BinaryConn(context.Context) net.Conn {
	return &streamNetConn{viewer: v}
}

type streamNetConn struct {
	viewer *streamViewer
	mu     sync.Mutex
	unread []byte
}

func (c *streamNetConn) Read(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for len(c.unread) == 0 {
		kind, payload, err := c.viewer.Read(c.viewer.conn.Context())
		if err != nil {
			return 0, err
		}
		if kind != websocket.MessageBinary {
			return 0, errors.New("unexpected control frame in VNC stream")
		}
		c.unread = payload
	}
	n := copy(buffer, c.unread)
	c.unread = c.unread[n:]
	return n, nil
}

func (c *streamNetConn) Write(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	if err := c.viewer.Write(c.viewer.conn.Context(), websocket.MessageBinary, buffer); err != nil {
		return 0, err
	}
	return len(buffer), nil
}

func (c *streamNetConn) Close() error {
	return c.viewer.CloseNow()
}

func (c *streamNetConn) LocalAddr() net.Addr {
	return streamAddr{}
}

func (c *streamNetConn) RemoteAddr() net.Addr {
	return streamAddr{}
}

func (c *streamNetConn) SetDeadline(time.Time) error {
	return nil
}

func (c *streamNetConn) SetReadDeadline(time.Time) error {
	return nil
}

func (c *streamNetConn) SetWriteDeadline(time.Time) error {
	return nil
}

type streamAddr struct{}

func (streamAddr) Network() string { return "wails" }
func (streamAddr) String() string  { return "local" }

var _ httpapi.ViewerTransport = (*streamViewer)(nil)
var _ net.Conn = (*streamNetConn)(nil)
var _ io.ReadWriteCloser = (*streamNetConn)(nil)
