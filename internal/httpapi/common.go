package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
)

type principalKey struct{}
type desktopRequestKey struct{}

const maxJSONBodyBytes = 1 << 20

// principal returns the account established by RequireAuth.
func principal(r *http.Request) security.Principal {
	return r.Context().Value(principalKey{}).(security.Principal)
}

// DesktopRequest marks a request delivered by Wails' in-process asset server.
// Only the desktop entry point should call this before routing /api requests.
func DesktopRequest(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), desktopRequestKey{}, true))
}

// readJSON accepts exactly one bounded JSON value with known fields.
func readJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, 400, "invalid_json", "one JSON value expected")
		return false
	}
	return true
}

// writeJSON sends a JSON response with its status code.
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// writeError sends the shared API error envelope.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

type AuthMiddleware struct {
	service   *security.AuthService
	origin    string
	localUser model.User
	localCSRF string
	localMode bool
}

// NewAuthMiddleware creates cookie authentication and CSRF middleware.
func NewAuthMiddleware(service *security.AuthService, cfg config.Config, localUser model.User, localCSRF string) *AuthMiddleware {
	origin := cfg.PublicOrigin
	if cfg.LocalMode {
		origin = ""
	}
	return &AuthMiddleware{
		service:   service,
		origin:    origin,
		localUser: localUser,
		localCSRF: localCSRF,
		localMode: cfg.LocalMode,
	}
}

// LocalMode reports whether account routes are disabled.
func (m *AuthMiddleware) LocalMode() bool {
	return m.localMode
}

// RequireAuth establishes the current owner and checks CSRF on mutations.
func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.localMode {
			desktop := r.Context().Value(desktopRequestKey{}) == true
			if !desktop && !localRequestHost(r.Host) {
				writeError(w, 403, "invalid_host", "local mode requires a loopback host")
				return
			}
			if !desktop && r.Header.Get("Origin") != "" && !m.ValidOrigin(r) {
				writeError(w, 403, "invalid_origin", "request origin is not allowed")
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead &&
				r.Method != http.MethodOptions && r.Header.Get("X-CSRF-Token") != m.localCSRF {
				writeError(w, 403, "csrf", "invalid CSRF token")
				return
			}
			identity := security.Principal{User: m.localUser, CSRFToken: m.localCSRF}
			ctx := context.WithValue(r.Context(), principalKey{}, identity)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		cookie, err := r.Cookie("lr_session")
		if err != nil {
			writeError(w, 401, "unauthorized", "login required")
			return
		}
		identity, err := m.service.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			writeError(w, 401, "unauthorized", "session expired")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead &&
			r.Method != http.MethodOptions && r.Header.Get("X-CSRF-Token") != identity.CSRFToken {
			writeError(w, 403, "csrf", "invalid CSRF token")
			return
		}
		ctx := context.WithValue(r.Context(), principalKey{}, identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func localRequestHost(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
		if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
			host = host[1 : len(host)-1]
		}
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// RequireAdmin restricts user-management routes to administrators.
func (m *AuthMiddleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if principal(r).User.Role != "admin" {
			writeError(w, 403, "forbidden", "admin required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ValidOrigin checks the browser origin before a WebSocket upgrade.
func (m *AuthMiddleware) ValidOrigin(r *http.Request) bool {
	value := r.Header.Get("Origin")
	if value == "" {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return false
	}
	if m.origin != "" {
		return strings.TrimRight(value, "/") == strings.TrimRight(m.origin, "/")
	}
	return parsed.Host == r.Host && (parsed.Scheme == "https" || parsed.Scheme == "http")
}
