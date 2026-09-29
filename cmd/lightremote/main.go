package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/httpapi"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
	"github.com/akmalfairuz/lightremote/internal/work"
)

// main logs startup failures and exits with a nonzero status.
func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

// run assembles the backend and serves requests until shutdown.
func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		if len(os.Args) != 3 || os.Args[1] != "migrate" || (os.Args[2] != "up" && os.Args[2] != "down") {
			return errors.New("usage: lightremote [migrate up|migrate down]")
		}
		command = os.Args[2]
	}
	cfg, err := config.LoadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     cfg.DatabaseDriver,
		SQLitePath: cfg.SQLitePath,
		MySQL: store.MySQLSettings{
			Host:     cfg.MySQLHost,
			Port:     cfg.MySQLPort,
			User:     cfg.MySQLUser,
			Password: cfg.MySQLPassword,
			Database: cfg.MySQLDatabase,
		},
	})
	if err != nil {
		return err
	}
	defer db.Close()
	if command == "down" {
		return migrations.Down(ctx, db)
	}
	if err := migrations.Up(ctx, db); err != nil {
		return err
	}
	if command == "up" {
		return nil
	}
	vault, err := security.NewVault(cfg.EncryptionKey)
	if err != nil {
		return err
	}

	users := store.NewUserRepository(db)
	loginSessions := store.NewLoginSessionRepository(db)
	folderRepository := store.NewFolderRepository(db)
	connectionRepository := store.NewConnectionRepository(db)

	authService := security.NewAuthService(users, loginSessions, cfg.SessionTTL)
	var localUser model.User
	var localCSRF string
	if cfg.LocalMode {
		localUser, err = security.BootstrapLocalUser(ctx, users)
		if err != nil {
			return err
		}
		localCSRF, err = security.RandomToken()
		if err != nil {
			return err
		}
	} else {
		if err := authService.BootstrapAdmin(ctx, cfg.AdminEmail, cfg.AdminPassword); err != nil {
			return err
		}
		go func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
					_ = loginSessions.DeleteExpired(cleanup)
					cancel()
				}
			}
		}()
	}
	folderService := folders.NewService(folderRepository)
	connectionService := connections.NewService(connectionRepository, folderService, vault)
	workSessions := work.NewManager()
	authMiddleware := httpapi.NewAuthMiddleware(authService, cfg, localUser, localCSRF)

	handler := httpapi.Router(httpapi.Routes{
		Auth:        httpapi.NewAuthHandler(authService, workSessions, connectionService, cfg),
		Users:       httpapi.NewUserHandler(users, authService, workSessions),
		Folders:     httpapi.NewFolderHandler(folderService),
		Connections: httpapi.NewConnectionHandler(connectionService, workSessions, cfg.DialTimeout),
		Files:       httpapi.NewFileHandler(connectionService, workSessions, cfg.DialTimeout, cfg.MaxUploadBytes),
		Work:        httpapi.NewWorkHandler(connectionService, workSessions, authMiddleware, cfg.DialTimeout),
		Middleware:  authMiddleware,
		Database:    db,
	})
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()

	log.Printf("lightremote listening on %s", cfg.ListenAddr)
	err = server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
