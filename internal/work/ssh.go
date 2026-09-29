package work

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
	"golang.org/x/crypto/ssh"
)

const (
	sshHistoryLimit = 1 << 20
	initialPTYRows  = 24
	initialPTYCols  = 80
)

// SSHRuntime owns a remote shell independently of a browser WebSocket.
type SSHRuntime struct {
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser

	mu        sync.Mutex
	writeMu   sync.Mutex
	chunks    [][]byte
	first     uint64
	next      uint64
	bytes     int
	notify    chan struct{}
	done      chan struct{}
	closeOnce sync.Once
}

// StartSSH opens one remote shell and begins recording bounded recent output.
func StartSSH(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (*SSHRuntime, error) {
	client, err := remote.DialSSH(ctx, connection, secret, timeout)
	if err != nil {
		return nil, err
	}
	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, err
	}
	closeFailed := func(err error) (*SSHRuntime, error) {
		session.Close()
		client.Close()
		return nil, err
	}
	if err := session.RequestPty("xterm-256color", initialPTYRows, initialPTYCols, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		return closeFailed(err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		return closeFailed(err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		return closeFailed(err)
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return closeFailed(err)
	}
	if err := session.Shell(); err != nil {
		return closeFailed(err)
	}
	runtime := &SSHRuntime{
		client:  client,
		session: session,
		stdin:   stdin,
		notify:  make(chan struct{}),
		done:    make(chan struct{}),
	}
	go runtime.record(stdout)
	go runtime.record(stderr)
	go func() {
		_ = session.Wait()
		runtime.Close()
	}()
	return runtime, nil
}

// record adds remote output to the bounded replay buffer.
func (r *SSHRuntime) record(source io.Reader) {
	buffer := make([]byte, 32*1024)
	for {
		count, err := source.Read(buffer)
		if count > 0 {
			chunk := append([]byte(nil), buffer[:count]...)
			r.mu.Lock()
			r.chunks = append(r.chunks, chunk)
			r.next++
			r.bytes += len(chunk)
			for r.bytes > sshHistoryLimit && len(r.chunks) > 1 {
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
func (r *SSHRuntime) Output(ctx context.Context, sequence uint64) ([]byte, uint64, bool) {
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
			return nil, sequence, false
		case <-notify:
		}
	}
}

// Write sends terminal input to the preserved shell.
func (r *SSHRuntime) Write(data []byte) (int, error) {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	return r.stdin.Write(data)
}

// Resize changes the remote pseudo-terminal dimensions.
func (r *SSHRuntime) Resize(rows, cols int) error {
	return r.session.WindowChange(rows, cols)
}

// Close releases the shell and notifies every attached viewer.
func (r *SSHRuntime) Close() {
	r.closeOnce.Do(func() {
		close(r.done)
		_ = r.stdin.Close()
		_ = r.session.Close()
		_ = r.client.Close()
	})
}
