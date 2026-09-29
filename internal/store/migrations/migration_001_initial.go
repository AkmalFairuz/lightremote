package migrations

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type initialSchema struct{}

// Version identifies the original account and connection schema.
func (initialSchema) Version() int {
	return 1
}

var mysqlInitialStatements = []string{
	`CREATE TABLE IF NOT EXISTS users (
			id CHAR(36) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
			password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL,
			disabled BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(6) NOT NULL
		)`,
	`CREATE TABLE IF NOT EXISTS login_sessions (
			token_hash BINARY(32) PRIMARY KEY, user_id CHAR(36) NOT NULL,
			csrf_token VARCHAR(64) NOT NULL, expires_at DATETIME(6) NOT NULL,
			INDEX idx_login_sessions_user (user_id),
			INDEX idx_login_sessions_expiry (expires_at),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	`CREATE TABLE IF NOT EXISTS folders (
			id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
			parent_id CHAR(36) NULL, name VARCHAR(255) NOT NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_folders_user_parent (user_id, parent_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE RESTRICT
		)`,
	`CREATE TABLE IF NOT EXISTS connections (
			id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
			folder_id CHAR(36) NULL, name VARCHAR(255) NOT NULL,
			kind VARCHAR(16) NOT NULL, host VARCHAR(255) NOT NULL,
			port INT NOT NULL, username VARCHAR(255) NOT NULL,
			auth_type VARCHAR(16) NOT NULL, ftp_tls BOOLEAN NOT NULL DEFAULT FALSE,
			secret BLOB NULL, host_key VARCHAR(255) NULL,
			created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
			INDEX idx_connections_user_folder (user_id, folder_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
		)`,
}

var sqliteInitialStatements = []string{
	`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL, role TEXT NOT NULL,
		disabled INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS login_sessions (
		token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL,
		csrf_token TEXT NOT NULL, expires_at DATETIME NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_login_sessions_expiry ON login_sessions(expires_at)`,
	`CREATE TABLE IF NOT EXISTS folders (
		id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
		parent_id TEXT NULL, name TEXT NOT NULL,
		created_at DATETIME NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE RESTRICT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id)`,
	`CREATE TABLE IF NOT EXISTS connections (
		id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
		folder_id TEXT NULL, name TEXT NOT NULL,
		kind TEXT NOT NULL, host TEXT NOT NULL,
		port INTEGER NOT NULL, username TEXT NOT NULL,
		auth_type TEXT NOT NULL, ftp_tls INTEGER NOT NULL DEFAULT 0,
		secret BLOB NULL, host_key TEXT NULL,
		created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_connections_user_folder ON connections(user_id, folder_id)`,
}

// Up creates the original tables in foreign-key dependency order.
func (initialSchema) Up(ctx context.Context, conn *sqlx.Conn, driver string) error {
	statements := mysqlInitialStatements
	if driver == "sqlite" {
		statements = sqliteInitialStatements
	} else if driver != "mysql" {
		return fmt.Errorf("unsupported migration driver %q", driver)
	}
	for index, statement := range statements {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create table %d: %w", index+1, err)
		}
	}
	return nil
}

// Down removes the original tables in reverse foreign-key dependency order.
func (initialSchema) Down(ctx context.Context, conn *sqlx.Conn, _ string) error {
	statements := []string{
		"DROP TABLE IF EXISTS connections",
		"DROP TABLE IF EXISTS folders",
		"DROP TABLE IF EXISTS login_sessions",
		"DROP TABLE IF EXISTS users",
	}
	for index, statement := range statements {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("drop table %d: %w", index+1, err)
		}
	}
	return nil
}
