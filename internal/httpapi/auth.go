package httpapi

import (
	"errors"
	"net"
	"net/http"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/work"
)

type AuthHandler struct {
	service     *security.AuthService
	cfg         config.Config
	sessions    *work.Manager
	connections *connections.Service
}

// NewAuthHandler wires account login and self-service endpoints.
func NewAuthHandler(service *security.AuthService, sessions *work.Manager, connections *connections.Service, cfg config.Config) *AuthHandler {
	return &AuthHandler{
		service:     service,
		sessions:    sessions,
		connections: connections,
		cfg:         cfg,
	}
}

// Login creates a database-backed browser session.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	clientIP, _, splitErr := net.SplitHostPort(r.RemoteAddr)
	if splitErr != nil {
		clientIP = r.RemoteAddr
	}
	result, err := h.service.Login(r.Context(), clientIP, input.Email, input.Password)
	if errors.Is(err, security.ErrRateLimited) {
		writeError(w, 429, "rate_limited", "try again later")
		return
	}
	if errors.Is(err, security.ErrInvalidCredentials) {
		writeError(w, 401, "invalid_credentials", "invalid credentials")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not create session")
		return
	}
	h.writeLogin(w, result)
}

// writeLogin returns the session credential and shared login response.
func (h *AuthHandler) writeLogin(w http.ResponseWriter, result security.LoginResult) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{
		"user":      result.User,
		"csrfToken": result.CSRFToken,
		"localMode": false,
		"token":     result.Token,
		"expiresAt": result.ExpiresAt,
	})
}

// Me returns the authenticated user and current CSRF token.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	identity := principal(r)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{
		"user":      identity.User,
		"csrfToken": identity.CSRFToken,
		"localMode": h.cfg.LocalMode,
	})
}

// Logout invalidates the current browser session.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Logout(r.Context(), principal(r).TokenHash); err != nil {
		writeError(w, 500, "internal", "could not invalidate session")
		return
	}
	h.sessions.CloseUser(principal(r).User.ID)
	h.connections.DeleteDirectOwner(principal(r).User.ID)
	w.WriteHeader(http.StatusNoContent)
}

// ChangePassword rotates a user's password and revokes their other login sessions.
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Current string `json:"currentPassword"`
		Next    string `json:"newPassword"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	err := h.service.ChangePassword(r.Context(), principal(r), input.Current, input.Next)
	if errors.Is(err, security.ErrInvalidCredentials) {
		writeError(w, 403, "invalid_password", "current password is wrong")
		return
	}
	if err != nil {
		writeError(w, 400, "invalid_password", err.Error())
		return
	}
	h.sessions.CloseUser(principal(r).User.ID)
	h.connections.DeleteDirectOwner(principal(r).User.ID)
	w.WriteHeader(http.StatusNoContent)
}
