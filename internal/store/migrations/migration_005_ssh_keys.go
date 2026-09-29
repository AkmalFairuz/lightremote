package migrations

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type sshKeys struct{}

func (sshKeys) Version() int {
	return 5
}

func (sshKeys) Up(ctx context.Context, conn *sqlx.Conn, driver string) error {
	var table string
	switch driver {
	case "mysql":
		table = `CREATE TABLE IF NOT EXISTS ssh_keys (
			id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
			name VARCHAR(255) NOT NULL, secret MEDIUMBLOB NOT NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_ssh_keys_user (user_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`
	case "sqlite":
		table = `CREATE TABLE IF NOT EXISTS ssh_keys (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
			name TEXT NOT NULL, secret BLOB NOT NULL,
			created_at DATETIME NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`
	default:
		return fmt.Errorf("unsupported migration driver %q", driver)
	}
	if _, err := conn.ExecContext(ctx, table); err != nil {
		return err
	}
	if driver == "sqlite" {
		if _, err := conn.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON ssh_keys(user_id)"); err != nil {
			return err
		}
	}
	exists, err := connectionColumnExists(ctx, conn, driver, "ssh_key_id")
	if err != nil || exists {
		return err
	}
	statement := "ALTER TABLE connections ADD COLUMN ssh_key_id TEXT NULL REFERENCES ssh_keys(id) ON DELETE RESTRICT"
	if driver == "mysql" {
		statement = `ALTER TABLE connections
			ADD COLUMN ssh_key_id CHAR(36) NULL,
			ADD CONSTRAINT fk_connections_ssh_key FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE RESTRICT`
	}
	_, err = conn.ExecContext(ctx, statement)
	return err
}

func (sshKeys) Down(ctx context.Context, conn *sqlx.Conn, driver string) error {
	var count int
	if err := conn.GetContext(ctx, &count, "SELECT COUNT(*) FROM connections WHERE ssh_key_id IS NOT NULL"); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("cannot remove SSH keys while connections use them")
	}
	if driver == "mysql" {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP FOREIGN KEY fk_connections_ssh_key"); err != nil {
			return err
		}
	}
	if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP COLUMN ssh_key_id"); err != nil {
		return err
	}
	_, err := conn.ExecContext(ctx, "DROP TABLE ssh_keys")
	return err
}
