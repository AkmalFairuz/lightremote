package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/model"
)

func TestLocalModeRemovesAccountRoutesAndRequiresCSRF(t *testing.T) {
	cfg := config.Config{LocalMode: true}
	user := model.User{ID: "local-id", Email: "local@lightremote.invalid", Role: "user"}
	middleware := NewAuthMiddleware(nil, cfg, user, "local-csrf")
	handler := Router(Routes{
		Auth:       NewAuthHandler(nil, nil, nil, cfg),
		Middleware: middleware,
	})

	request := func(method, path, host, origin, csrf string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, nil)
		r.Host = host
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if csrf != "" {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}

	me := request(http.MethodGet, "/api/auth/me", "127.0.0.1:8080", "", "")
	if me.Code != http.StatusOK {
		t.Fatalf("local identity without cookie: %d: %s", me.Code, me.Body.String())
	}
	var identity struct {
		User      model.User `json:"user"`
		CSRFToken string     `json:"csrfToken"`
		LocalMode bool       `json:"localMode"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &identity); err != nil {
		t.Fatal(err)
	}
	if identity.User.ID != user.ID || identity.CSRFToken != "local-csrf" || !identity.LocalMode {
		t.Fatalf("unexpected local identity: %+v", identity)
	}
	if me.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("identity response must not be cached")
	}

	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/api/auth/login"},
		{http.MethodPost, "/api/auth/logout"},
		{http.MethodPut, "/api/auth/password"},
		{http.MethodGet, "/api/users"},
	} {
		if got := request(route.method, route.path, "127.0.0.1:8080", "", "local-csrf").Code; got != http.StatusNotFound {
			t.Fatalf("%s %s should be absent, got %d", route.method, route.path, got)
		}
	}

	if got := request(http.MethodGet, "/api/auth/me", "evil.example:8080", "", "").Code; got != http.StatusForbidden {
		t.Fatalf("non-loopback Host should be rejected, got %d", got)
	}
	if got := request(http.MethodGet, "/api/auth/me", "127.0.0.1:8080", "http://evil.example", "").Code; got != http.StatusForbidden {
		t.Fatalf("cross-origin request should be rejected, got %d", got)
	}
	if got := request(http.MethodPost, "/api/folders", "127.0.0.1:8080", "", "").Code; got != http.StatusForbidden {
		t.Fatalf("mutation without CSRF should be rejected, got %d", got)
	}
}

func TestDesktopLocalRequestStillRequiresCSRF(t *testing.T) {
	cfg := config.Config{LocalMode: true}
	user := model.User{ID: "local-id", Email: "local@lightremote.invalid", Role: "user"}
	handler := Router(Routes{
		Auth:       NewAuthHandler(nil, nil, nil, cfg),
		Middleware: NewAuthMiddleware(nil, cfg, user, "local-csrf"),
	})
	request := func(method, token string) int {
		t.Helper()
		path := "/api/auth/me"
		if method == http.MethodPost {
			path = "/api/folders"
		}
		r := httptest.NewRequest(method, path, nil)
		r.Host = "wails.localhost"
		r.Header.Set("Origin", "wails://wails.localhost")
		if token != "" {
			r.Header.Set("X-CSRF-Token", token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, DesktopRequest(r))
		return w.Code
	}
	if got := request(http.MethodGet, ""); got != http.StatusOK {
		t.Fatalf("desktop identity request: %d", got)
	}
	if got := request(http.MethodPost, ""); got != http.StatusForbidden {
		t.Fatalf("desktop mutation without CSRF: %d", got)
	}
}
