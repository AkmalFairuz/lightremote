package migrations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

var ErrNoAppliedMigration = errors.New("no applied migration to roll back")

// Migration defines one ordered, reversible database schema change.
type Migration interface {
	Version() int
	Up(ctx context.Context, conn *sqlx.Conn, driver string) error
	Down(ctx context.Context, conn *sqlx.Conn, driver string) error
}

var registered = []Migration{initialSchema{}, proxySettings{}, vncDisplaySettings{}}

// Up applies every pending migration in version order.
func Up(ctx context.Context, db *sqlx.DB) error {
	return withConnection(ctx, db, func(conn *sqlx.Conn) error {
		applied, err := appliedVersions(ctx, conn)
		if err != nil {
			return err
		}
		if err := checkVersions(applied); err != nil {
			return err
		}
		for _, migration := range registered {
			if applied[migration.Version()] {
				if migration.Version() == 3 {
					// Version 3 repairs legacy columns and adds newer VNC options in place.
					if err := migration.Up(ctx, conn, db.DriverName()); err != nil {
						return fmt.Errorf("repair migration 3: %w", err)
					}
				}
				continue
			}
			if err := migration.Up(ctx, conn, db.DriverName()); err != nil {
				return fmt.Errorf("migration %d up: %w", migration.Version(), err)
			}
			if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES (?)", migration.Version()); err != nil {
				return fmt.Errorf("record migration %d: %w", migration.Version(), err)
			}
		}
		return nil
	})
}

// Down rolls back the latest applied migration by one version.
func Down(ctx context.Context, db *sqlx.DB) error {
	return withConnection(ctx, db, func(conn *sqlx.Conn) error {
		applied, err := appliedVersions(ctx, conn)
		if err != nil {
			return err
		}
		if err := checkVersions(applied); err != nil {
			return err
		}
		for index := len(registered) - 1; index >= 0; index-- {
			migration := registered[index]
			if !applied[migration.Version()] {
				continue
			}
			if err := migration.Down(ctx, conn, db.DriverName()); err != nil {
				return fmt.Errorf("migration %d down: %w", migration.Version(), err)
			}
			if _, err := conn.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = ?", migration.Version()); err != nil {
				return fmt.Errorf("remove migration %d: %w", migration.Version(), err)
			}
			return nil
		}
		return ErrNoAppliedMigration
	})
}

// withConnection serializes migrations using the selected engine's locking mechanism.
func withConnection(ctx context.Context, db *sqlx.DB, action func(*sqlx.Conn) error) error {
	switch db.DriverName() {
	case "mysql":
		return withMySQLConnection(ctx, db, action)
	case "sqlite":
		return withSQLiteConnection(ctx, db, action)
	default:
		return fmt.Errorf("unsupported migration driver %q", db.DriverName())
	}
}

// withMySQLConnection holds an advisory lock during a migration command.
func withMySQLConnection(ctx context.Context, db *sqlx.DB, action func(*sqlx.Conn) error) error {
	conn, err := db.Connx(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var acquired int
	if err := conn.GetContext(ctx, &acquired, "SELECT GET_LOCK('lightremote_migrations', 30)"); err != nil {
		return err
	}
	if acquired != 1 {
		return errors.New("timed out waiting for database migration lock")
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released int
		_ = conn.GetContext(releaseCtx, &released, "SELECT RELEASE_LOCK('lightremote_migrations')")
	}()
	return action(conn)
}

// withSQLiteConnection runs a migration command in one immediate write transaction.
func withSQLiteConnection(ctx context.Context, db *sqlx.DB, action func(*sqlx.Conn) error) error {
	conn, err := db.Connx(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return fmt.Errorf("begin sqlite migration: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		}
	}()
	if err := action(conn); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return fmt.Errorf("commit sqlite migration: %w", err)
	}
	committed = true
	return nil
}

// appliedVersions reads or creates the migration version table.
func appliedVersions(ctx context.Context, conn *sqlx.Conn) (map[int]bool, error) {
	if _, err := conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY)"); err != nil {
		return nil, err
	}
	var versions []int
	if err := conn.SelectContext(ctx, &versions, "SELECT version FROM schema_migrations ORDER BY version"); err != nil {
		return nil, err
	}
	applied := make(map[int]bool, len(versions))
	for _, version := range versions {
		applied[version] = true
	}
	return applied, nil
}

// checkVersions rejects databases migrated by a newer or incompatible binary.
func checkVersions(applied map[int]bool) error {
	for version := range applied {
		known := false
		for _, migration := range registered {
			if migration.Version() == version {
				known = true
				break
			}
		}
		if !known {
			return fmt.Errorf("unknown database migration version %d", version)
		}
	}
	return nil
}
