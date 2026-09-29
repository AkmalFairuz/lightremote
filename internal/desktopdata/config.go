package desktopdata

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/akmalfairuz/lightremote/internal/config"
)

// Directory returns the per-user location for desktop-only state.
func Directory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "LightRemote"), nil
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			return "", errors.New("LOCALAPPDATA is not set")
		}
		return filepath.Join(base, "LightRemote"), nil
	default:
		base := os.Getenv("XDG_DATA_HOME")
		if base == "" {
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, "lightremote"), nil
	}
}

// Config provisions the SQLite database and its persistent encryption key.
func Config() (config.Config, error) {
	dir, err := Directory()
	if err != nil {
		return config.Config{}, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return config.Config{}, fmt.Errorf("create desktop data directory: %w", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(dir, 0700); err != nil {
			return config.Config{}, fmt.Errorf("restrict desktop data directory: %w", err)
		}
	}
	dbPath := filepath.Join(dir, "lightremote.db")
	keyPath := filepath.Join(dir, "vault.key")
	key, err := loadOrCreateKey(keyPath, dbPath)
	if err != nil {
		return config.Config{}, err
	}
	return config.Config{
		LocalMode:      true,
		DatabaseDriver: "sqlite",
		SQLitePath:     dbPath,
		EncryptionKey:  key,
		SessionTTL:     24 * time.Hour,
		MaxUploadBytes: 1 << 30,
		DialTimeout:    10 * time.Second,
	}, nil
}

func loadOrCreateKey(keyPath, dbPath string) (string, error) {
	value, err := os.ReadFile(keyPath)
	if err == nil {
		if runtime.GOOS != "windows" {
			info, statErr := os.Stat(keyPath)
			if statErr != nil {
				return "", fmt.Errorf("check desktop vault key permissions: %w", statErr)
			}
			if info.Mode().Perm()&0077 != 0 {
				return "", errors.New("desktop vault key must be readable only by the current user")
			}
		}
		key, decodeErr := base64.StdEncoding.DecodeString(string(value))
		if decodeErr != nil || len(key) != 32 {
			return "", errors.New("desktop vault key is invalid; restore the original key to read saved credentials")
		}
		return string(value), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read desktop vault key: %w", err)
	}
	if _, err := os.Stat(dbPath); err == nil {
		return "", errors.New("desktop vault key is missing; restore it to read saved credentials")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("check desktop database: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", fmt.Errorf("generate desktop vault key: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(key)
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", fmt.Errorf("create desktop vault key: %w", err)
	}
	if _, err := file.WriteString(encoded); err != nil {
		file.Close()
		os.Remove(keyPath)
		return "", fmt.Errorf("write desktop vault key: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(keyPath)
		return "", fmt.Errorf("sync desktop vault key: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close desktop vault key: %w", err)
	}
	return encoded, nil
}
