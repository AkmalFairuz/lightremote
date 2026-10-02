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

// SSHRuntime owns a remote shell independently of a browser WebSocket.
type SSHRuntime struct {
	terminalOutput
	client    *ssh.Client
	session   *ssh.Session
	stdin     io.WriteCloser
	writeMu   sync.Mutex
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
		client:         client,
		session:        session,
		stdin:          stdin,
		terminalOutput: newTerminalOutput(),
	}
	go runtime.record(stdout)
	go runtime.record(stderr)
	go func() {
		_ = session.Wait()
		runtime.Close()
	}()
	return runtime, nil
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
