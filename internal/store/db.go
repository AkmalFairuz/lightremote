package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

type DatabaseSettings struct {
	Driver     string
	SQLitePath string
	MySQL      MySQLSettings
}

type MySQLSettings struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
}

// Open connects to the selected database engine.
func Open(ctx context.Context, settings DatabaseSettings) (*sqlx.DB, error) {
	switch settings.Driver {
	case "sqlite":
		return openSQLite(ctx, settings.SQLitePath)
	case "mysql":
		return openMySQL(ctx, settings.MySQL)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", settings.Driver)
	}
}

// openMySQL connects to MySQL and sets pool limits.
func openMySQL(ctx context.Context, settings MySQLSettings) (*sqlx.DB, error) {
	driverConfig := mysql.NewConfig()
	driverConfig.User = settings.User
	driverConfig.Passwd = settings.Password
	driverConfig.Net = "tcp"
	driverConfig.Addr = net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port))
	driverConfig.DBName = settings.Database
	driverConfig.ParseTime = true
	driverConfig.Loc = time.UTC
	connector, err := mysql.NewConnector(driverConfig)
	if err != nil {
		return nil, err
	}
	db := sqlx.NewDb(sql.OpenDB(connector), "mysql")
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(3 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect mysql: %w", err)
	}
	return db, nil
}

// openSQLite connects to a persistent SQLite database with connection-local safeguards.
func openSQLite(ctx context.Context, path string) (*sqlx.DB, error) {
	if path == "" {
		return nil, errors.New("SQLite path is empty")
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve SQLite path: %w", err)
	}
	databaseURL := sqliteFileURL(absolutePath)
	parameters := url.Values{}
	parameters.Add("_pragma", "foreign_keys(1)")
	parameters.Add("_pragma", "busy_timeout(5000)")
	databaseURL.RawQuery = parameters.Encode()

	db, err := sqlx.Open("sqlite", databaseURL.String())
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect sqlite: %w", err)
	}
	return db, nil
}

func sqliteFileURL(absolutePath string) url.URL {
	uriPath := filepath.ToSlash(absolutePath)
	if len(uriPath) >= 2 && uriPath[1] == ':' {
		drive := uriPath[0]
		upperDrive := drive >= 'A' && drive <= 'Z'
		lowerDrive := drive >= 'a' && drive <= 'z'
		if upperDrive || lowerDrive {
			// SQLite expects file:///C:/..., with the drive in the URI path.
			uriPath = "/" + uriPath
		}
	}
	return url.URL{Scheme: "file", Path: uriPath}
}
