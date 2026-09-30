package httpapi

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// WithFrontend adds browser assets and SPA navigation without changing API routing.
func WithFrontend(api http.Handler, directory string) (http.Handler, error) {
	if directory == "" {
		return api, nil
	}
	frontend := os.DirFS(directory)
	index, err := fs.Stat(frontend, "index.html")
	if err != nil {
		return nil, fmt.Errorf("open frontend index in %q: %w", directory, err)
	}
	if !index.Mode().IsRegular() {
		return nil, fmt.Errorf("frontend index in %q must be a regular file", directory)
	}
	indexFile, err := frontend.Open("index.html")
	if err != nil {
		return nil, fmt.Errorf("read frontend index in %q: %w", directory, err)
	}
	_ = indexFile.Close()
	files := http.FileServer(http.FS(frontend))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath := path.Clean("/" + r.URL.Path)
		if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") ||
			requestPath == "/healthz" || strings.HasPrefix(requestPath, "/healthz/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(requestPath, "/")
		if name != "" {
			info, err := fs.Stat(frontend, name)
			if err == nil {
				if !info.Mode().IsRegular() {
					http.NotFound(w, r)
					return
				}
				if name == "index.html" {
					w.Header().Set("Cache-Control", "no-cache")
				}
				files.ServeHTTP(w, r)
				return
			}
			if !errors.Is(err, fs.ErrNotExist) {
				http.Error(w, "could not read frontend asset", http.StatusInternalServerError)
				return
			}
			if name == "assets" || strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
		}

		w.Header().Set("Cache-Control", "no-cache")
		request := r.Clone(r.Context())
		request.URL.Path = "/"
		request.URL.RawPath = ""
		files.ServeHTTP(w, request)
	}), nil
}
