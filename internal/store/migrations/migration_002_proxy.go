package migrations

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type proxySettings struct{}

type proxyColumn struct {
	name       string
	definition string
}

var proxyColumns = []proxyColumn{
	{"proxy_type", "VARCHAR(8) NULL"},
	{"proxy_host", "VARCHAR(255) NULL"},
	{"proxy_port", "INT NULL"},
	{"proxy_username", "VARCHAR(255) NULL"},
	{"proxy_secret", "BLOB NULL"},
}

// Version identifies the optional per-connection proxy schema change.
func (proxySettings) Version() int {
	return 2
}

// Up adds proxy settings while preserving existing connections.
func (proxySettings) Up(ctx context.Context, conn *sqlx.Conn, driver string) error {
	for _, column := range proxyColumns {
		exists, err := connectionColumnExists(ctx, conn, driver, column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN "+column.name+" "+column.definition); err != nil {
			return fmt.Errorf("add %s: %w", column.name, err)
		}
	}
	return nil
}

// Down removes proxy settings in reverse order.
func (proxySettings) Down(ctx context.Context, conn *sqlx.Conn, driver string) error {
	for index := len(proxyColumns) - 1; index >= 0; index-- {
		column := proxyColumns[index]
		exists, err := connectionColumnExists(ctx, conn, driver, column.name)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if _, err := conn.ExecContext(ctx, "ALTER TABLE connections DROP COLUMN "+column.name); err != nil {
			return fmt.Errorf("drop %s: %w", column.name, err)
		}
	}
	return nil
}

// connectionColumnExists checks whether a proxy column survived a partial migration.
func connectionColumnExists(ctx context.Context, conn *sqlx.Conn, driver, name string) (bool, error) {
	var count int
	switch driver {
	case "mysql":
		err := conn.GetContext(ctx, &count, `
			SELECT COUNT(*) FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connections' AND COLUMN_NAME = ?`, name)
		return count > 0, err
	case "sqlite":
		err := conn.GetContext(ctx, &count,
			"SELECT COUNT(*) FROM pragma_table_info('connections') WHERE name = ?", name)
		return count > 0, err
	default:
		return false, fmt.Errorf("unsupported migration driver %q", driver)
	}
}
