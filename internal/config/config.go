package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	ListenAddr        string        `env:"LISTEN_ADDR" envDefault:":8080"`
	FrontendDir       string        `env:"FRONTEND_DIR"`
	LocalMode         bool          `env:"LOCAL_MODE" envDefault:"false"`
	DatabaseDriver    string        `env:"DATABASE_DRIVER" envDefault:"sqlite"`
	SQLitePath        string        `env:"SQLITE_PATH" envDefault:"./lightremote.db"`
	MySQLHost         string        `env:"MYSQL_HOST"`
	MySQLPort         int           `env:"MYSQL_PORT" envDefault:"3306"`
	MySQLUser         string        `env:"MYSQL_USER"`
	MySQLPassword     string        `env:"MYSQL_PASSWORD"`
	MySQLDatabase     string        `env:"MYSQL_DATABASE"`
	EncryptionKey     string        `env:"ENCRYPTION_KEY"`
	EncryptionKeyFile string        `env:"ENCRYPTION_KEY_FILE"`
	AdminEmail        string        `env:"ADMIN_EMAIL" envDefault:"admin@localhost"`
	AdminPassword     string        `env:"ADMIN_PASSWORD"`
	PublicOrigin      string        `env:"PUBLIC_ORIGIN"`
	SessionTTL        time.Duration `env:"SESSION_TTL" envDefault:"24h"`
	MaxUploadBytes    int64         `env:"MAX_UPLOAD_BYTES" envDefault:"1073741824"`
	DialTimeout       time.Duration `env:"DIAL_TIMEOUT" envDefault:"10s"`
}

// LoadConfig loads optional local defaults and validates required process settings.
func LoadConfig() (Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, fmt.Errorf("load .env: %w", err)
	}
	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return cfg, err
	}
	if cfg.SessionTTL <= 0 || cfg.MaxUploadBytes <= 0 || cfg.DialTimeout <= 0 {
		return cfg, errors.New("timeouts and MAX_UPLOAD_BYTES must be positive")
	}
	switch cfg.DatabaseDriver {
	case "sqlite":
		if cfg.SQLitePath == "" {
			return cfg, errors.New("SQLITE_PATH is required when DATABASE_DRIVER=sqlite")
		}
	case "mysql":
		if cfg.MySQLHost == "" || cfg.MySQLUser == "" || cfg.MySQLPassword == "" || cfg.MySQLDatabase == "" {
			return cfg, errors.New("MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE are required when DATABASE_DRIVER=mysql")
		}
		if cfg.MySQLPort < 1 || cfg.MySQLPort > 65535 {
			return cfg, errors.New("MYSQL_PORT must be between 1 and 65535")
		}
	default:
		return cfg, fmt.Errorf("unsupported DATABASE_DRIVER %q", cfg.DatabaseDriver)
	}
	if cfg.PublicOrigin != "" && !strings.HasPrefix(cfg.PublicOrigin, "https://") && !strings.HasPrefix(cfg.PublicOrigin, "http://") {
		return cfg, errors.New("PUBLIC_ORIGIN must be an http(s) origin")
	}
	if cfg.LocalMode && !LoopbackHost(cfg.ListenAddr) {
		return cfg, errors.New("LOCAL_MODE requires LISTEN_ADDR to use a loopback IP")
	}
	return cfg, nil
}

// LoopbackHost reports whether an address uses an explicit loopback IP.
func LoopbackHost(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
