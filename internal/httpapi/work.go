package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
)

type WorkHandler struct {
	connections *connections.Service
	sessions    *work.Manager
	auth        *AuthMiddleware
	dialTimeout time.Duration
}

// NewWorkHandler wires SSH and VNC work-session endpoints.
func NewWorkHandler(connections *connections.Service, sessions *work.Manager, auth *AuthMiddleware, dialTimeout time.Duration) *WorkHandler {
	return &WorkHandler{
		connections: connections,
		sessions:    sessions,
		auth:        auth,
		dialTimeout: dialTimeout,
	}
}

// Create reserves one of the current user's 32 work slots.
func (h *WorkHandler) Create(w http.ResponseWriter, r *http.Request) {
	connection, err := h.connections.Get(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"))
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	if connection.Kind != "ssh" && connection.Kind != "vnc" {
		writeError(w, 400, "invalid_connection", "SSH or VNC connection required")
		return
	}
	session, err := h.sessions.Create(principal(r).User.ID, connection.ID, connection.Kind)
	if errors.Is(err, work.ErrLimit) {
		writeError(w, 409, "session_limit", err.Error())
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not create work session")
		return
	}
	writeJSON(w, 201, session)
}

// List returns the current user's work sessions.
func (h *WorkHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, h.sessions.List(principal(r).User.ID))
}

// Get returns a work session and its live traffic counters.
func (h *WorkHandler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := h.sessions.Get(principal(r).User.ID, chi.URLParam(r, "sessionID"))
	if !ok {
		writeError(w, 404, "not_found", "work session not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"session": session,
		"metrics": session.Metrics(),
	})
}

// Delete closes a work session and releases its slot.
func (h *WorkHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.sessions.Delete(principal(r).User.ID, chi.URLParam(r, "sessionID")) {
		writeError(w, 404, "not_found", "work session not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// WebSocket upgrades an authenticated work session to its protocol stream.
func (h *WorkHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	if !h.auth.ValidOrigin(r) {
		writeError(w, 403, "invalid_origin", "WebSocket origin is not allowed")
		return
	}
	session, ok := h.sessions.Get(principal(r).User.ID, chi.URLParam(r, "sessionID"))
	if !ok {
		writeError(w, 404, "not_found", "work session not found")
		return
	}
	connection, err := h.connections.Get(r.Context(), principal(r).User.ID, session.ConnectionID)
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	secret, err := h.connections.Credentials(r.Context(), connection)
	if err != nil {
		writeError(w, 500, "internal", "could not decrypt credentials")
		return
	}
	socket, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	defer socket.CloseNow()
	viewerCtx, finish, err := session.Attach(func() { _ = socket.CloseNow() }, func() {
		h.sessions.DeleteDetached(session.UserID, session.ID)
	})
	if err != nil {
		_ = socket.Close(websocket.StatusTryAgainLater, "previous viewer did not release the session")
		return
	}
	defer finish()

	ctx := viewerCtx
	cancel := func() {}
	if !h.auth.LocalMode() {
		ctx, cancel = context.WithDeadline(viewerCtx, principal(r).ExpiresAt)
	}
	defer cancel()
	go func() {
		select {
		case <-r.Context().Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	switch connection.Kind {
	case "ssh":
		runtime, err := session.EnsureSSH(ctx, connection, secret, h.dialTimeout)
		if err != nil {
			sendControl(ctx, socket, "error", err.Error())
			return
		}
		h.serveSSHViewer(ctx, socket, session, runtime)
	case "vnc":
		bridge, err := session.EnsureVNC(ctx, connection, secret, h.dialTimeout)
		if err != nil {
			_ = socket.Close(websocket.StatusInternalError, vncCloseReason(err))
			return
		}
		defer session.SetFiles(nil)
		_ = bridge.Serve(ctx, socket, session.RecordReceived, session.RecordSent, func() {
			session.SetFiles(bridge.Files(false))
		})
	}
}

// serveSSHViewer bridges one browser attachment to a preserved shell.
func (h *WorkHandler) serveSSHViewer(ctx context.Context, socket *websocket.Conn, workSession *work.Session, runtime *work.SSHRuntime) {
	sendControl(ctx, socket, "ready", "")
	go func() {
		var sequence uint64
		for {
			chunk, next, ok := runtime.Output(ctx, sequence)
			if !ok {
				_ = socket.Close(websocket.StatusNormalClosure, "SSH session ended")
				return
			}
			if err := socket.Write(ctx, websocket.MessageBinary, chunk); err != nil {
				return
			}
			workSession.RecordSent(len(chunk))
			sequence = next
		}
	}()

	for {
		messageType, payload, err := socket.Read(ctx)
		if err != nil {
			return
		}
		if messageType == websocket.MessageBinary {
			if _, err := runtime.Write(payload); err != nil {
				return
			}
			workSession.RecordReceived(len(payload))
			continue
		}
		var control struct {
			Type string `json:"type"`
			Rows int    `json:"rows"`
			Cols int    `json:"cols"`
		}
		if json.Unmarshal(payload, &control) == nil && control.Type == "resize" &&
			control.Rows > 0 && control.Cols > 0 && control.Rows <= 1000 && control.Cols <= 1000 {
			_ = runtime.Resize(control.Rows, control.Cols)
		}
	}
}

// vncCloseReason preserves the remote failure detail within WebSocket's close-reason limit.
func vncCloseReason(err error) string {
	const maxReasonBytes = 123
	var reason strings.Builder
	for _, character := range strings.ToValidUTF8(err.Error(), "�") {
		if character < ' ' {
			continue
		}
		if reason.Len()+utf8.RuneLen(character) > maxReasonBytes {
			break
		}
		reason.WriteRune(character)
	}
	if reason.Len() == 0 {
		return "VNC connection failed"
	}
	return reason.String()
}

// sendControl reports SSH readiness or a setup error over a text WebSocket message.
func sendControl(ctx context.Context, socket *websocket.Conn, kind, message string) {
	payload, _ := json.Marshal(map[string]string{"type": kind, "message": message})
	_ = socket.Write(ctx, websocket.MessageText, payload)
}
