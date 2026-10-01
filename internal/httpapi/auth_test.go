package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
)

func TestBearerAuthenticationLifecycle(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{Driver: "sqlite", SQLitePath: filepath.Join(t.TempDir(), "auth.db")})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	sessions := store.NewLoginSessionRepository(db)
	service := security.NewAuthService(store.NewUserRepository(db), sessions, time.Hour)
	cfg := config.Config{}
	manager := work.NewManager()
	repository := store.NewConnectionRepository(db)
	connectionService := connections.NewService(repository, nil, &security.Vault{}, nil)
	auth := NewAuthHandler(service, manager, connectionService, cfg)
	middleware := NewAuthMiddleware(service, cfg, model.User{}, "")
	var login struct {
		Token     string     `json:"token"`
		CSRFToken string     `json:"csrfToken"`
		ExpiresAt time.Time  `json:"expiresAt"`
		User      model.User `json:"user"`
	}
	for _, setup := range []bool{true, false} {
		request := httptest.NewRequest(http.MethodPost, "http://localhost/api/auth/login", strings.NewReader(`{"email":"admin@example.com","password":"test-password"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "http://localhost")
		response := httptest.NewRecorder()
		if setup {
			auth.Setup(response, request)
		} else {
			auth.Login(response, request)
		}
		if response.Code != http.StatusOK {
			t.Fatalf("login/setup: %d %s", response.Code, response.Body.String())
		}
		if response.Header().Get("Set-Cookie") != "" || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("credentials must be uncached JSON without cookies")
		}
		if err := json.Unmarshal(response.Body.Bytes(), &login); err != nil {
			t.Fatal(err)
		}
		if login.Token == "" || login.CSRFToken == "" || !login.ExpiresAt.After(time.Now()) {
			t.Fatal("missing login credential or expiry")
		}
	}
	protected := middleware.RequireAuth(http.HandlerFunc(auth.Me))
	request := func(method, token, csrf, cookie string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://localhost/api/auth/me", nil)
		if token != "" {
			r.Header.Set("Authorization", token)
		}
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: "lr_session", Value: cookie})
		}
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		protected.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		name, method, authorization, csrf, cookie string
		status                                    int
	}{
		{"bearer", "GET", "Bearer " + login.Token, "", "", 200},
		{"cookie rejected", "GET", "", "", login.Token, 401},
		{"malformed bearer", "GET", "Bearer " + login.Token + " extra", "", "", 401},
		{"mutation without csrf", "POST", "Bearer " + login.Token, "", "", 403},
		{"mutation with csrf", "POST", "Bearer " + login.Token, login.CSRFToken, "", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := request(tc.method, tc.authorization, tc.csrf, tc.cookie); got.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", got.Code, tc.status, got.Body.String())
			}
		})
	}
	if strings.Contains(request("GET", "Bearer "+login.Token, "", "").Body.String(), `"token"`) {
		t.Fatal("me must not return a session credential")
	}
	expired := "expired-token"
	if err := sessions.Create(ctx, security.TokenDigest(expired), store.LoginSession{UserID: login.User.ID, CSRFToken: "csrf", ExpiresAt: time.Now().UTC().Add(-time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if got := request("GET", "Bearer "+expired, "", ""); got.Code != 401 {
		t.Fatalf("expired token: %d", got.Code)
	}

	// Exercise the production viewer handler before any remote connection is opened.
	viewer := middleware.RequireAuth(http.HandlerFunc(NewWorkHandler(nil, work.NewManager(), middleware, time.Second).WebSocket))
	for _, tc := range []struct {
		origin string
		status int
	}{{"http://evil.example", 403}, {"http://localhost", 404}} {
		r := httptest.NewRequest("GET", "http://localhost/api/sessions/not-owned/ws", nil)
		r.Header.Set("Upgrade", "websocket")
		r.Header.Set("Sec-WebSocket-Protocol", "lightremote, lightremote.auth."+login.Token)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		viewer.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("viewer origin/ownership: %d, want %d", w.Code, tc.status)
		}
	}

	// The unapproved SSH host fails before dialing, after the real upgrade succeeds.
	now := time.Now().UTC()
	connection := model.Connection{ID: "viewer-connection", UserID: login.User.ID, Name: "test", Kind: "ssh", Host: "unused.invalid", Port: 22, AuthType: "none", VNCEncoding: "auto", CreatedAt: now, UpdatedAt: now}
	if err := repository.Create(ctx, connection); err != nil {
		t.Fatal(err)
	}
	workSession, err := manager.Create(login.User.ID, connection.ID, "ssh")
	if err != nil {
		t.Fatal(err)
	}
	workHandler := NewWorkHandler(connectionService, manager, middleware, time.Second)
	router := chi.NewRouter()
	router.With(middleware.RequireAuth).Get("/api/sessions/{sessionID}/ws", workHandler.WebSocket)
	server := httptest.NewServer(router)
	defer server.Close()
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	socket, response, err := websocket.Dial(dialCtx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/sessions/"+workSession.ID+"/ws", &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{server.URL}},
		Subprotocols: []string{"lightremote", "lightremote.auth." + login.Token},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.CloseNow()
	if socket.Subprotocol() != "lightremote" || response.Header.Get("Sec-WebSocket-Protocol") != "lightremote" {
		t.Fatal("viewer must negotiate only the public protocol without echoing credentials")
	}
	logoutRequest := httptest.NewRequest("POST", "/api/auth/logout", nil)
	logoutRequest.Header.Set("Authorization", "Bearer "+login.Token)
	logoutRequest.Header.Set("X-CSRF-Token", login.CSRFToken)
	logoutResponse := httptest.NewRecorder()
	middleware.RequireAuth(http.HandlerFunc(auth.Logout)).ServeHTTP(logoutResponse, logoutRequest)
	if logoutResponse.Code != http.StatusNoContent || logoutResponse.Header().Get("Set-Cookie") != "" {
		t.Fatalf("logout: %d %s", logoutResponse.Code, logoutResponse.Body.String())
	}

	if got := request("GET", "Bearer "+login.Token, "", ""); got.Code != 401 {
		t.Fatalf("revoked token: %d", got.Code)
	}
}

func TestWebSocketCredentialsAreRestrictedToViewerUpgrades(t *testing.T) {
	for _, tc := range []struct {
		path, upgrade, protocols string
		want                     string
	}{
		{"/api/sessions/id/ws", "websocket", "lightremote, lightremote.auth.token", "token"},
		{"/api/auth/me", "websocket", "lightremote.auth.token", ""},
		{"/api/sessions/id/ws", "", "lightremote.auth.token", ""},
		{"/api/sessions/id/ws?token=token", "websocket", "lightremote", ""},
		{"/api/sessions/id/ws", "websocket", "lightremote.auth.token, lightremote.auth.other", ""},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		r.Header.Set("Upgrade", tc.upgrade)
		r.Header.Set("Sec-WebSocket-Protocol", tc.protocols)
		if got := requestSessionToken(r); got != tc.want {
			t.Fatalf("%s: token %q, want %q", tc.path, got, tc.want)
		}
	}
}
