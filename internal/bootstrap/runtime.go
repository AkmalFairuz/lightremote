package bootstrap

import (
	"context"
	"time"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/httpapi"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/sshkeys"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/jmoiron/sqlx"
)

// Runtime owns the services shared by browser and desktop entry points.
type Runtime struct {
	Database  *sqlx.DB
	Routes    httpapi.Routes
	Sessions  *work.Manager
	LocalUser model.User
}

// New opens storage, applies migrations, and assembles the API services.
func New(ctx context.Context, cfg config.Config) (*Runtime, error) {
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
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = db.Close()
		}
	}()
	if err = migrations.Up(ctx, db); err != nil {
		return nil, err
	}
	vault, err := security.NewVault(cfg.EncryptionKey)
	if err != nil {
		return nil, err
	}

	users := store.NewUserRepository(db)
	loginSessions := store.NewLoginSessionRepository(db)
	folderRepository := store.NewFolderRepository(db)
	connectionRepository := store.NewConnectionRepository(db)
	keyService := sshkeys.NewService(db, vault)
	if err = keyService.MigrateLegacy(ctx); err != nil {
		return nil, err
	}

	authService := security.NewAuthService(users, loginSessions, cfg.SessionTTL)
	var localUser model.User
	var localCSRF string
	if cfg.LocalMode {
		localUser, err = security.BootstrapLocalUser(ctx, users)
		if err != nil {
			return nil, err
		}
		localCSRF, err = security.RandomToken()
		if err != nil {
			return nil, err
		}
	} else {
		if err = authService.BootstrapAdmin(ctx, cfg.AdminEmail, cfg.AdminPassword); err != nil {
			return nil, err
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
	connectionService := connections.NewService(connectionRepository, folderService, vault, keyService)
	workSessions := work.NewManager()
	authMiddleware := httpapi.NewAuthMiddleware(authService, cfg, localUser, localCSRF)
	routes := httpapi.Routes{
		Auth:        httpapi.NewAuthHandler(authService, workSessions, connectionService, cfg),
		Users:       httpapi.NewUserHandler(users, authService, workSessions),
		Folders:     httpapi.NewFolderHandler(folderService),
		Connections: httpapi.NewConnectionHandler(connectionService, workSessions, cfg.DialTimeout),
		SSHKeys:     httpapi.NewSSHKeyHandler(keyService),
		Files:       httpapi.NewFileHandler(connectionService, workSessions, cfg.DialTimeout, cfg.MaxUploadBytes),
		Work:        httpapi.NewWorkHandler(connectionService, workSessions, authMiddleware, cfg.DialTimeout),
		Middleware:  authMiddleware,
		Database:    db,
	}
	return &Runtime{Database: db, Routes: routes, Sessions: workSessions, LocalUser: localUser}, nil
}

// Close releases active sessions and the database.
func (r *Runtime) Close() error {
	if r.LocalUser.ID != "" {
		r.Sessions.CloseUser(r.LocalUser.ID)
	}
	return r.Database.Close()
}
