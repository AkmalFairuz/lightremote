package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/go-chi/chi/v5"
)

// TestVNCCloseReason keeps detailed failure text valid for a WebSocket close frame.
func TestVNCCloseReason(t *testing.T) {
	reason := vncCloseReason(errors.New(strings.Repeat("é", 100)))
	if len(reason) > 123 || !utf8.ValidString(reason) {
		t.Fatalf("invalid WebSocket close reason: %q", reason)
	}
	if reason == "" {
		t.Fatal("connection failure detail was lost")
	}
}

func TestTelnetSessionAndFileBoundaries(t *testing.T) {
	service := connections.NewService(nil, nil, nil, nil)
	connection, err := service.CreateDirect(context.Background(), "owner", model.ConnectionInput{
		Kind: "telnet", Host: "router.example", Port: 23, AuthType: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.DeleteDirect("owner", connection.ID)
	manager := work.NewManager()
	defer manager.CloseUser("owner")
	auth := NewAuthMiddleware(nil, config.Config{LocalMode: true}, model.User{ID: "owner"}, "csrf")
	handler := NewWorkHandler(service, manager, auth, time.Second)
	files := NewFileHandler(service, manager, time.Second, 1024)
	router := chi.NewRouter()
	router.Use(auth.RequireAuth)
	router.Post("/connections/{connectionID}/sessions", handler.Create)
	router.Get("/connections/{connectionID}/files", files.List)
	r := httptest.NewRequest(http.MethodPost, "/connections/"+connection.ID+"/sessions", nil)
	r.Header.Set("X-CSRF-Token", "csrf")
	r.Host = "127.0.0.1:8080"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("Telnet session creation returned %d: %s", w.Code, w.Body.String())
	}
	var session work.Session
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Kind != "telnet" || session.ConnectionID != connection.ID || session.ID == "" {
		t.Fatalf("unexpected Telnet session: %s", w.Body.String())
	}
	r = httptest.NewRequest(http.MethodGet, "/connections/"+connection.ID+"/files?path=/", nil)
	r.Host = "127.0.0.1:8080"
	w = httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Telnet file request returned %d: %s", w.Code, w.Body.String())
	}
	if err := files.DownloadLocal(context.Background(), "owner", connection.ID, "/file.txt", io.Discard); !errors.Is(err, remote.ErrUnsupported) {
		t.Fatalf("desktop Telnet download was not rejected: %v", err)
	}
}
