package httpapi

import (
	"errors"
	"mime"
	"net"
	"net/http"
	"strings"

	"github.com/akmalfairuz/lightremote/internal/security"
)

// SetupStatus exposes only whether the first administrator still needs to be created.
func (h *AuthHandler) SetupStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	required, err := h.service.SetupRequired(r.Context())
	if err != nil {
		writeError(w, 500, "internal", "could not check installation status")
		return
	}
	writeJSON(w, 200, map[string]bool{"required": required})
}

// Setup installs the first administrator and signs in the browser that created it.
func (h *AuthHandler) Setup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !validOrigin(r, h.cfg.PublicOrigin) {
		writeError(w, 403, "invalid_origin", "installation requires a same-origin request")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, 415, "invalid_content_type", "installation requires application/json")
		return
	}
	clientIP, _, splitErr := net.SplitHostPort(r.RemoteAddr)
	if splitErr != nil {
		clientIP = r.RemoteAddr
	}
	if !h.service.AllowSetupAttempt(clientIP) {
		writeError(w, 429, "rate_limited", "try again later")
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	err = h.service.SetupAdmin(r.Context(), input.Email, input.Password)
	if errors.Is(err, security.ErrSetupComplete) {
		writeError(w, 409, "setup_complete", err.Error())
		return
	}
	if errors.Is(err, security.ErrInvalidSetup) {
		writeError(w, 400, "invalid_email", err.Error())
		return
	}
	if err != nil {
		if errors.Is(err, security.ErrPasswordTooShort) {
			writeError(w, 400, "invalid_password", err.Error())
		} else {
			writeError(w, 500, "internal", "could not complete installation")
		}
		return
	}
	result, err := h.service.Login(r.Context(), clientIP, input.Email, input.Password)
	if err != nil {
		writeError(w, 500, "login_failed", "administrator created; sign in with the password you chose")
		return
	}
	h.writeLogin(w, result)
}
