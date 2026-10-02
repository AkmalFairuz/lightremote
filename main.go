//go:build !server

package main

import (
	"context"
	"embed"
	"encoding/base64"
	"errors"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	goruntime "runtime"
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
	app             *application.App
	runtime         *bootstrap.Runtime
	recentMenu      *application.Menu
	menuMutex       sync.Mutex
	menuLabels      map[string]func(string)
	menuText        map[string]string
	emptyRecentItem *application.MenuItem
}

// OpenDetached opens a native window for the existing detached-tab route.
func (s *DesktopService) OpenDetached(transferID string) error {
	if _, err := uuid.Parse(transferID); err != nil {
		return errors.New("invalid detached tab ID")
	}
	name := "detached-" + transferID
	window := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      name,
		Title:     "LightRemote",
		Width:     1100,
		Height:    750,
		URL:       "/detached/" + transferID,
		Frameless: goruntime.GOOS != "darwin",
		Mac:       application.MacWindow{TitleBar: application.MacTitleBarHidden},
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
func (s *DesktopService) SaveRemoteFile(connectionID, remotePath, filename, transferID string) (bool, error) {
	destination, err := s.app.Dialog.SaveFile().SetFilename(filepath.Base(filename)).PromptForSingleSelection()
	if err != nil {
		return false, err
	}
	if destination == "" {
		return false, nil
	}
	err = saveFile(destination, func(file *os.File) error {
		writer := &downloadProgressWriter{
			file: file,
			onProgress: func(loaded int64) {
				s.app.Event.Emit("lightremote:download-progress", map[string]any{
					"id": transferID, "loaded": loaded,
				})
			},
		}
		writer.flush()
		err := s.runtime.Routes.Files.DownloadLocal(context.Background(), s.runtime.LocalUser.ID, connectionID, remotePath, writer)
		writer.flush()
		return err
	})
	return err == nil, err
}

type downloadProgressWriter struct {
	file       *os.File
	onProgress func(int64)
	loaded     int64
	lastUpdate time.Time
}

func (w *downloadProgressWriter) Write(data []byte) (int, error) {
	n, err := w.file.Write(data)
	w.loaded += int64(n)
	if time.Since(w.lastUpdate) >= 100*time.Millisecond {
		w.flush()
	}
	return n, err
}

func (w *downloadProgressWriter) flush() {
	w.onProgress(w.loaded)
	w.lastUpdate = time.Now()
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

func openDesktopLog() (*os.File, string, error) {
	directory, err := desktopdata.Directory()
	if err != nil {
		return nil, "", err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, "", err
	}
	path := filepath.Join(directory, "lightremote.log")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, path, err
	}
	return file, path, nil
}

func runDesktop(wailsLogger *slog.Logger) error {
	log.Print("starting LightRemote desktop")
	cfg, err := desktopdata.Config()
	if err != nil {
		return err
	}
	log.Printf("desktop data directory: %s", filepath.Dir(cfg.SQLitePath))
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
	log.Print("desktop backend ready")
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
		Logger:      wailsLogger,
		LogLevel:    slog.LevelInfo,
		ErrorHandler: func(err error) {
			log.Printf("Wails error: %v", err)
		},
		PanicHandler: func(details *application.PanicDetails) {
			log.Printf("Wails panic: %v\n%s", details.Error, details.FullStackTrace)
		},
		Assets: application.AssetOptions{
			Handler:    application.BundledAssetFileServer(assets),
			Middleware: desktopAssetsMiddleware(api),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:      "com.akmalfairuz.lightremote",
			EncryptionKey: instanceKey,
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				log.Print("second LightRemote instance launched")
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
	app.HandleStream("telnet", func(conn *application.StreamConn) {
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
		Frameless: goruntime.GOOS != "darwin",
		Mac:       application.MacWindow{TitleBar: application.MacTitleBarHidden},
	})
	if goruntime.GOOS == "darwin" {
		installMacMenu(app, mainWindow, service)
	}
	mainWindow.Show()
	log.Print("opening desktop window")
	err = app.Run()
	log.Printf("desktop event loop ended: %v", err)
	return err
}

func main() {
	logFile, logPath, logErr := openDesktopLog()
	var output io.Writer = os.Stderr
	if logErr == nil {
		output = logFile
	} else {
		logPath = ""
	}
	log.SetOutput(output)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if logErr != nil {
		log.Printf("could not open desktop log: %v", logErr)
	}
	wailsLogger := slog.New(slog.NewTextHandler(output, nil))
	if err := runDesktop(wailsLogger); err != nil {
		log.Printf("start LightRemote desktop: %v", err)
		if logFile != nil {
			_ = logFile.Sync()
			_ = logFile.Close()
		}
		showStartupError(err, logPath)
		os.Exit(1)
	}
	if logFile != nil {
		_ = logFile.Close()
	}
}
