package migrations

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type vncDisplaySettings struct{}

func (vncDisplaySettings) Version() int {
	return 3
}

// Up maintains VNC display options in both new and already-migrated databases.
func (vncDisplaySettings) Up(ctx context.Context, conn *sqlx.Conn, driver string) error {
	exists, err := connectionColumnExists(ctx, conn, driver, "vnc_encoding")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN vnc_encoding VARCHAR(8) NOT NULL DEFAULT 'auto'"); err != nil {
			return fmt.Errorf("add vnc_encoding: %w", err)
		}
	}
	readOnlyExists, err := connectionColumnExists(ctx, conn, driver, "vnc_read_only")
	if err != nil {
		return err
	}
	if !readOnlyExists {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN vnc_read_only BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
			return fmt.Errorf("add vnc_read_only: %w", err)
		}
	}
	fileTransferExists, err := connectionColumnExists(ctx, conn, driver, "vnc_file_transfer")
	if err != nil {
		return err
	}
	if !fileTransferExists {
		// Existing read-only connections retain their previous file access.
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN vnc_file_transfer BOOLEAN NOT NULL DEFAULT TRUE"); err != nil {
			return fmt.Errorf("add vnc_file_transfer: %w", err)
		}
	}

	legacyDepth, err := connectionColumnExists(ctx, conn, driver, "vnc_depth")
	if err != nil {
		return err
	}
	if legacyDepth {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP COLUMN vnc_depth"); err != nil {
			return fmt.Errorf("drop vnc_depth: %w", err)
		}
	}
	return nil
}

func (vncDisplaySettings) Down(ctx context.Context, conn *sqlx.Conn, driver string) error {
	for _, name := range []string{"vnc_file_transfer", "vnc_read_only", "vnc_depth", "vnc_encoding"} {
		exists, err := connectionColumnExists(ctx, conn, driver, name)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP COLUMN "+name); err != nil {
			return fmt.Errorf("drop %s: %w", name, err)
		}
	}
	return nil
}
