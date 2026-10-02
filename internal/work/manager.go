package work

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
	"github.com/google/uuid"
)

const (
	maxWorkSessions    = 32
	viewerHandoffWait  = 5 * time.Second
	detachedSessionTTL = 2 * time.Minute
)

var ErrLimit = fmt.Errorf("%d work sessions are already open", maxWorkSessions)
var ErrAlreadyAttached = errors.New("work session is already attached")
var ErrClosed = errors.New("work session is closed")

type Session struct {
	ID           string    `json:"id"`
	UserID       string    `json:"-"`
	ConnectionID string    `json:"connectionId"`
	Kind         string    `json:"kind"`
	CreatedAt    time.Time `json:"createdAt"`

	Context context.Context `json:"-"`
	cancel  context.CancelFunc

	attached     atomic.Bool
	closed       atomic.Bool
	detachedAt   atomic.Int64
	viewerMu     sync.Mutex
	takeoverMu   sync.Mutex
	viewerCancel context.CancelFunc
	viewerClose  func()
	viewerDone   chan struct{}
	cleanupTimer *time.Timer
	terminalMu   sync.Mutex
	terminal     TerminalRuntime
	vncMu        sync.Mutex
	vnc          *remote.VNCBridge
	received     atomic.Int64
	sent         atomic.Int64
	activeAt     atomic.Int64
	filesMu      sync.RWMutex
	files        remote.FileClient
}

// Attach replaces the current viewer while leaving the remote session alive.
func (s *Session) Attach(closeViewer func(), onDetached func()) (context.Context, func(), error) {
	s.takeoverMu.Lock()
	defer s.takeoverMu.Unlock()
	if s.closed.Load() {
		return nil, nil, ErrClosed
	}
	s.viewerMu.Lock()
	previousCancel := s.viewerCancel
	previousClose := s.viewerClose
	previousDone := s.viewerDone
	s.viewerMu.Unlock()
	if previousCancel != nil {
		previousCancel()
		previousClose()
		select {
		case <-previousDone:
		case <-time.After(viewerHandoffWait):
			return nil, nil, ErrAlreadyAttached
		}
	}
	s.viewerMu.Lock()
	defer s.viewerMu.Unlock()
	if s.cleanupTimer != nil {
		s.cleanupTimer.Stop()
	}
	s.detachedAt.Store(0)
	ctx, cancel := context.WithCancel(s.Context)
	done := make(chan struct{})
	s.viewerCancel = cancel
	s.viewerClose = closeViewer
	s.viewerDone = done
	s.attached.Store(true)
	finish := func() {
		s.viewerMu.Lock()
		defer s.viewerMu.Unlock()
		if s.viewerDone != done {
			return
		}
		cancel()
		s.viewerCancel = nil
		s.viewerClose = nil
		s.viewerDone = nil
		s.attached.Store(false)
		s.detachedAt.Store(time.Now().UnixMilli())
		close(done)
		s.cleanupTimer = time.AfterFunc(detachedSessionTTL, onDetached)
	}
	return ctx, finish, nil
}

// EnsureTerminal starts the remote terminal once for this work session.
func (s *Session) EnsureTerminal(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (TerminalRuntime, error) {
	s.terminalMu.Lock()
	defer s.terminalMu.Unlock()
	if s.terminal != nil {
		return s.terminal, nil
	}
	var runtime TerminalRuntime
	var err error
	switch connection.Kind {
	case "ssh":
		runtime, err = StartSSH(ctx, connection, secret, timeout)
	case "telnet":
		runtime, err = StartTelnet(ctx, connection, secret, timeout)
	default:
		return nil, errors.New("terminal connection required")
	}
	if err != nil {
		return nil, err
	}
	s.terminal = runtime
	return runtime, nil
}

// EnsureVNC starts one upstream VNC bridge for all browser attachments.
func (s *Session) EnsureVNC(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (*remote.VNCBridge, error) {
	s.vncMu.Lock()
	defer s.vncMu.Unlock()
	if s.vnc != nil {
		return s.vnc, nil
	}
	bridge, err := remote.NewVNCBridge(ctx, connection, secret, timeout)
	if err != nil {
		return nil, err
	}
	s.vnc = bridge
	return bridge, nil
}

// closeResources serializes shutdown with viewer handoffs.
func (s *Session) closeResources() {
	s.takeoverMu.Lock()
	defer s.takeoverMu.Unlock()
	s.closeResourcesLocked()
}

// closeResourcesLocked shuts down the session while takeoverMu is held.
func (s *Session) closeResourcesLocked() {
	if s.closed.Swap(true) {
		return
	}
	s.cancel()
	s.viewerMu.Lock()
	if s.cleanupTimer != nil {
		s.cleanupTimer.Stop()
	}
	if s.viewerCancel != nil {
		s.viewerCancel()
		s.viewerClose()
	}
	s.viewerMu.Unlock()
	s.terminalMu.Lock()
	if s.terminal != nil {
		s.terminal.Close()
	}
	s.terminalMu.Unlock()
	s.vncMu.Lock()
	if s.vnc != nil {
		_ = s.vnc.Close()
	}
	s.vncMu.Unlock()
}

// expiredUnattached checks the current viewer-free grace period.
func (s *Session) expiredUnattached() bool {
	if s.attached.Load() {
		return false
	}
	if detached := s.detachedAt.Load(); detached != 0 {
		return time.Since(time.UnixMilli(detached)) > detachedSessionTTL
	}
	return time.Since(s.CreatedAt) > detachedSessionTTL
}

// RecordReceived counts bytes sent from the browser.
func (s *Session) RecordReceived(count int) {
	s.received.Add(int64(count))
	s.activeAt.Store(time.Now().UnixMilli())
}

// RecordSent counts bytes sent to the browser.
func (s *Session) RecordSent(count int) {
	s.sent.Add(int64(count))
	s.activeAt.Store(time.Now().UnixMilli())
}

// Metrics returns live byte counters and the last activity time.
func (s *Session) Metrics() map[string]any {
	return map[string]any{
		"bytesReceived": s.received.Load(),
		"bytesSent":     s.sent.Load(),
		"lastActivity":  time.UnixMilli(s.activeAt.Load()).UTC(),
	}
}

// SetFiles exposes an active VNC bridge to the owner's file APIs.
func (s *Session) SetFiles(client remote.FileClient) {
	s.filesMu.Lock()
	s.files = client
	s.filesMu.Unlock()
}

// Files returns the active VNC bridge when its WebSocket has connected.
func (s *Session) Files() remote.FileClient {
	s.filesMu.RLock()
	defer s.filesMu.RUnlock()
	return s.files
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewManager creates the process-local work-session registry.
func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// Create reserves one of a user's 32 terminal or VNC work slots.
func (m *Manager) Create(userID, connectionID, kind string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	count := 0
	for id, session := range m.sessions {
		if session.expiredUnattached() {
			session.takeoverMu.Lock()
			if session.expiredUnattached() {
				session.closeResourcesLocked()
				delete(m.sessions, id)
				session.takeoverMu.Unlock()
				continue
			}
			session.takeoverMu.Unlock()
		}
		if session.UserID == userID {
			count++
		}
	}
	if count >= maxWorkSessions {
		return nil, ErrLimit
	}
	ctx, cancel := context.WithCancel(context.Background())
	now := time.Now().UTC()
	session := &Session{
		ID:           uuid.NewString(),
		UserID:       userID,
		ConnectionID: connectionID,
		Kind:         kind,
		CreatedAt:    now,
		Context:      ctx,
		cancel:       cancel,
	}
	session.activeAt.Store(now.UnixMilli())
	session.cleanupTimer = time.AfterFunc(detachedSessionTTL, func() {
		m.DeleteDetached(userID, session.ID)
	})
	m.sessions[session.ID] = session
	return session, nil
}

// DeleteDetached releases a reservation only if it still has no browser viewer.
func (m *Manager) DeleteDetached(ownerID, id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok || session.UserID != ownerID {
		return false
	}
	session.takeoverMu.Lock()
	defer session.takeoverMu.Unlock()
	if session.attached.Load() {
		return false
	}
	session.closeResourcesLocked()
	delete(m.sessions, id)
	return true
}

// Get returns a session only to its owner.
func (m *Manager) Get(ownerID, id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[id]
	return session, ok && session.UserID == ownerID
}

// List returns the active sessions owned by a user.
func (m *Manager) List(ownerID string) []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := []*Session{}
	for _, session := range m.sessions {
		if session.UserID == ownerID {
			list = append(list, session)
		}
	}
	return list
}

// FileClientForConnection finds an active VNC file channel or reports one still starting.
func (m *Manager) FileClientForConnection(ownerID, connectionID string) (remote.FileClient, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	starting := false
	for _, session := range m.sessions {
		if session.UserID != ownerID || session.ConnectionID != connectionID || session.Kind != "vnc" {
			continue
		}
		if client := session.Files(); client != nil {
			return client, true
		}
		if session.attached.Load() {
			starting = true
		}
	}
	return nil, starting
}

// Delete cancels a session and releases its slot.
func (m *Manager) Delete(ownerID, id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok || session.UserID != ownerID {
		return false
	}
	session.closeResources()
	delete(m.sessions, id)
	return true
}

// CloseUser cancels every work session owned by a disabled user.
func (m *Manager) CloseUser(userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, session := range m.sessions {
		if session.UserID == userID {
			session.closeResources()
			delete(m.sessions, id)
		}
	}
}

// CloseConnection cancels sessions for an edited or deleted connection.
func (m *Manager) CloseConnection(connectionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, session := range m.sessions {
		if session.ConnectionID == connectionID {
			session.closeResources()
			delete(m.sessions, id)
		}
	}
}
