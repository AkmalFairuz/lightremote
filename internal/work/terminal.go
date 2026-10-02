package work

import (
	"context"
	"io"
	"net"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
)

const (
	terminalHistoryLimit = 1 << 20
	initialPTYRows       = 24
	initialPTYCols       = 80
)

// TerminalRuntime preserves a terminal independently of its current viewer.
type TerminalRuntime interface {
	Output(context.Context, uint64) ([]byte, uint64, bool)
	Write([]byte) (int, error)
	Resize(int, int) error
	Close()
}

type terminalOutput struct {
	mu          sync.Mutex
	chunks      [][]byte
	first, next uint64
	bytes       int
	notify      chan struct{}
	done        chan struct{}
}

func newTerminalOutput() terminalOutput {
	return terminalOutput{notify: make(chan struct{}), done: make(chan struct{})}
}

// record adds remote output to the bounded replay buffer.
func (r *terminalOutput) record(source io.Reader) {
	buffer := make([]byte, 32*1024)
	for {
		count, err := source.Read(buffer)
		if count > 0 {
			chunk := append([]byte(nil), buffer[:count]...)
			r.mu.Lock()
			r.chunks = append(r.chunks, chunk)
			r.next++
			r.bytes += len(chunk)
			for r.bytes > terminalHistoryLimit && len(r.chunks) > 1 {
				r.bytes -= len(r.chunks[0])
				r.chunks = r.chunks[1:]
				r.first++
			}
			close(r.notify)
			r.notify = make(chan struct{})
			r.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// Output returns the next available chunk or waits for more remote output.
func (r *terminalOutput) Output(ctx context.Context, sequence uint64) ([]byte, uint64, bool) {
	for {
		r.mu.Lock()
		if sequence < r.first {
			sequence = r.first
		}
		if sequence < r.next {
			chunk := r.chunks[sequence-r.first]
			r.mu.Unlock()
			return chunk, sequence + 1, true
		}
		notify := r.notify
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, sequence, false
		case <-r.done:
			// A final chunk may have arrived between checking output and EOF.
			r.mu.Lock()
			finished := sequence >= r.next
			r.mu.Unlock()
			if finished {
				return nil, sequence, false
			}
		case <-notify:
		}
	}
}

// TelnetRuntime records decoded output from one persistent Telnet connection.
type TelnetRuntime struct {
	terminalOutput
	conn      *remote.TelnetConn
	closeOnce sync.Once
}

func StartTelnet(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (*TelnetRuntime, error) {
	socket, err := remote.DialConnection(ctx, connection, secret, remote.Address(connection), timeout)
	if err != nil {
		return nil, err
	}
	return newTelnetRuntime(socket), nil
}

func newTelnetRuntime(socket net.Conn) *TelnetRuntime {
	runtime := &TelnetRuntime{terminalOutput: newTerminalOutput(), conn: remote.NewTelnetConn(socket)}
	go func() {
		runtime.record(runtime.conn)
		runtime.Close()
	}()
	return runtime
}

func (r *TelnetRuntime) Write(data []byte) (int, error) {
	return r.conn.Write(data)
}

func (r *TelnetRuntime) Resize(rows, cols int) error {
	return r.conn.Resize(rows, cols)
}

func (r *TelnetRuntime) Close() {
	r.closeOnce.Do(func() {
		close(r.done)
		_ = r.conn.Close()
	})
}
