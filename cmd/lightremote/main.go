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

	"github.com/akmalfairuz/lightremote/internal/bootstrap"
	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/httpapi"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/sshkeys"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
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
	if command != "serve" {
		return migrate(ctx, cfg, command)
	}

	runtime, err := bootstrap.New(ctx, cfg)
	if err != nil {
		return err
	}
	defer runtime.Close()
	handler, err := httpapi.WithFrontend(httpapi.Router(runtime.Routes), cfg.FrontendDir)
	if err != nil {
		return err
	}
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

func migrate(ctx context.Context, cfg config.Config, command string) error {
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
	vault, err := security.NewVault(cfg.EncryptionKey)
	if err != nil {
		return err
	}
	return sshkeys.NewService(db, vault).MigrateLegacy(ctx)
}
