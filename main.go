//go:build !server

package main

import (
	"context"
	"embed"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/bootstrap"
	"github.com/akmalfairuz/lightremote/internal/desktop"
	"github.com/akmalfairuz/lightremote/internal/desktopdata"
	"github.com/akmalfairuz/lightremote/internal/httpapi"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed frontend/dist
var assets embed.FS

type DesktopService struct {
	app     *application.App
	runtime *bootstrap.Runtime
}

// OpenDetached opens a native window for the existing detached-tab route.
func (s *DesktopService) OpenDetached(transferID string) error {
	if _, err := uuid.Parse(transferID); err != nil {
		return errors.New("invalid detached tab ID")
	}
	name := "detached-" + transferID
	window := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   name,
		Title:  "LightRemote",
		Width:  1100,
		Height: 750,
		URL:    "/detached/" + transferID,
	})
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		time.AfterFunc(500*time.Millisecond, func() {
			s.app.Event.Emit("lightremote:detached-closed", transferID)
		})
	})
	window.Show()
	return nil
}

// SaveRemoteFile prompts for a local destination and streams a remote file to it.
func (s *DesktopService) SaveRemoteFile(connectionID, remotePath, filename string) error {
	destination, err := s.app.Dialog.SaveFile().SetFilename(filepath.Base(filename)).PromptForSingleSelection()
	if err != nil || destination == "" {
		return err
	}
	return saveFile(destination, func(file *os.File) error {
		return s.runtime.Routes.Files.DownloadLocal(context.Background(), s.runtime.LocalUser.ID, connectionID, remotePath, file)
	})
}

// SaveTextFile uses the native save dialog for generated SSH keys.
func (s *DesktopService) SaveTextFile(filename, contents string) error {
	destination, err := s.app.Dialog.SaveFile().SetFilename(filepath.Base(filename)).PromptForSingleSelection()
	if err != nil || destination == "" {
		return err
	}
	return saveFile(destination, func(file *os.File) error {
		_, err := file.WriteString(contents)
		return err
	})
}

// SaveImageFile writes a captured PNG through the native save dialog.
func (s *DesktopService) SaveImageFile(filename, encoded string) error {
	if len(encoded) > 64<<20 {
		return errors.New("screenshot is too large to save")
	}
	image, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return errors.New("screenshot data is invalid")
	}
	destination, err := s.app.Dialog.SaveFile().SetFilename(filepath.Base(filename)).PromptForSingleSelection()
	if err != nil || destination == "" {
		return err
	}
	return saveFile(destination, func(file *os.File) error {
		_, err := file.Write(image)
		return err
	})
}

func saveFile(destination string, write func(*os.File) error) error {
	file, err := os.CreateTemp(filepath.Dir(destination), ".lightremote-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return err
	}
	if err := write(file); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), destination)
}

func desktopAssetsMiddleware(api http.Handler) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
				api.ServeHTTP(w, httpapi.DesktopRequest(r))
				return
			}
			if r.Method == http.MethodGet && (strings.HasPrefix(r.URL.Path, "/detached/") ||
				r.URL.Path == "/login" || strings.HasPrefix(r.URL.Path, "/settings")) {
				index := r.Clone(r.Context())
				index.URL.Path = "/"
				next.ServeHTTP(w, index)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func runDesktop() error {
	cfg, err := desktopdata.Config()
	if err != nil {
		return err
	}
	key, err := base64.StdEncoding.DecodeString(cfg.EncryptionKey)
	if err != nil || len(key) != 32 {
		return errors.New("invalid desktop vault key")
	}
	var instanceKey [32]byte
	copy(instanceKey[:], key)
	ctx, cancel := context.WithCancel(context.Background())
	runtime, err := bootstrap.New(ctx, cfg)
	if err != nil {
		cancel()
		return err
	}
	var closeOnce sync.Once
	closeRuntime := func() {
		closeOnce.Do(func() {
			cancel()
			_ = runtime.Close()
		})
	}
	defer closeRuntime()
	api := httpapi.Router(runtime.Routes)
	var mainWindow *application.WebviewWindow
	service := &DesktopService{runtime: runtime}
	app := application.New(application.Options{
		Name:        "LightRemote",
		Description: "Remote desktop and file workspace",
		Services:    []application.Service{application.NewService(service)},
		Assets: application.AssetOptions{
			Handler:    application.BundledAssetFileServer(assets),
			Middleware: desktopAssetsMiddleware(api),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:      "com.akmalfairuz.lightremote",
			EncryptionKey: instanceKey,
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if mainWindow != nil {
					mainWindow.Restore()
					mainWindow.Focus()
				}
			},
		},
		OnShutdown: closeRuntime,
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	service.app = app
	app.HandleStream("ssh", func(conn *application.StreamConn) {
		desktop.ServeViewer(conn, runtime.Routes.Work)
	})
	app.HandleStream("vnc", func(conn *application.StreamConn) {
		desktop.ServeViewer(conn, runtime.Routes.Work)
	})
	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "LightRemote",
		Width:     1280,
		Height:    800,
		MinWidth:  800,
		MinHeight: 600,
		URL:       "/",
	})
	mainWindow.Show()
	return app.Run()
}

func main() {
	if err := runDesktop(); err != nil {
		log.Printf("start LightRemote desktop: %v", err)
		os.Exit(1)
	}
}
