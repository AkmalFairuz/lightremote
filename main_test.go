//go:build !server

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopAssetsKeepAPIRoutesAndDeepLinks(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("api:" + r.URL.Path))
	})
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("asset:" + r.URL.Path))
	})
	handler := desktopAssetsMiddleware(api)(assets)
	for _, test := range []struct {
		path string
		want string
	}{
		{"/api/auth/me", "api:/api/auth/me"},
		{"/detached/transfer-id", "asset:/"},
		{"/assets/app.js", "asset:/assets/app.js"},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		if got := response.Body.String(); got != test.want {
			t.Errorf("%s: got %q, want %q", test.path, got, test.want)
		}
	}
}
