package migrations

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type recentConnections struct{}

func (recentConnections) Version() int {
	return 4
}

// Up stores the last time a saved connection was opened, without changing its settings timestamp.
func (recentConnections) Up(ctx context.Context, conn *sqlx.Conn, driver string) error {
	exists, err := connectionColumnExists(ctx, conn, driver, "last_opened_at")
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	if _, err := conn.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN last_opened_at BIGINT NULL"); err != nil {
		return fmt.Errorf("add last_opened_at: %w", err)
	}
	return nil
}

func (recentConnections) Down(ctx context.Context, conn *sqlx.Conn, driver string) error {
	exists, err := connectionColumnExists(ctx, conn, driver, "last_opened_at")
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP COLUMN last_opened_at"); err != nil {
		return fmt.Errorf("drop last_opened_at: %w", err)
	}
	return nil
}
