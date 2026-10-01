package security

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/akmalfairuz/lightremote/internal/config"
	"github.com/jmoiron/sqlx"
)

// NewConfiguredVault uses an explicit key or a persistent generated key after schema migrations.
func NewConfiguredVault(ctx context.Context, cfg config.Config, db *sqlx.DB) (*Vault, error) {
	if cfg.EncryptionKey != "" {
		return NewVault(cfg.EncryptionKey)
	}
	keyPath := cfg.EncryptionKeyFile
	if keyPath == "" {
		keyPath = "vault.key"
		if cfg.DatabaseDriver == "sqlite" {
			keyPath = filepath.Join(filepath.Dir(cfg.SQLitePath), "vault.key")
		}
	}
	keyPath, err := filepath.Abs(keyPath)
	if err != nil {
		return nil, fmt.Errorf("resolve encryption key file: %w", err)
	}
	log.Printf("WARNING: ENCRYPTION_KEY is not set; using persistent generated key file %q. Back up this file with the database.", keyPath)

	vault, err := loadVaultFile(keyPath)
	if err == nil {
		return vault, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	var encrypted bool
	if err := db.GetContext(ctx, &encrypted, `
		SELECT EXISTS (
			SELECT 1 FROM connections WHERE LENGTH(secret) > 0 OR LENGTH(proxy_secret) > 0
		) OR EXISTS (
			SELECT 1 FROM ssh_keys WHERE LENGTH(secret) > 0
		)`); err != nil {
		return nil, fmt.Errorf("check existing encrypted credentials before generating a key: %w", err)
	}
	if encrypted {
		// Another initializer may have published the key and started saving credentials.
		vault, err := loadVaultFile(keyPath)
		if err == nil {
			return vault, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		return nil, fmt.Errorf("encryption key file %q is missing but the database contains encrypted credentials; restore the original file or set the original ENCRYPTION_KEY", keyPath)
	}
	return createVaultFile(keyPath)
}

// loadVaultFile rejects damaged keys and files readable by other users.
func loadVaultFile(keyPath string) (*Vault, error) {
	info, err := os.Stat(keyPath)
	if err != nil {
		return nil, fmt.Errorf("check encryption key file %q: %w", keyPath, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("encryption key file %q must be a regular file", keyPath)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("encryption key file %q must be readable only by its owner (permissions 0600)", keyPath)
	}
	file, err := os.Open(keyPath)
	if err != nil {
		return nil, fmt.Errorf("open encryption key file %q: %w", keyPath, err)
	}
	defer file.Close()
	const maxKeyFileBytes = 128
	value, err := io.ReadAll(io.LimitReader(file, maxKeyFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read encryption key file %q: %w", keyPath, err)
	}
	if len(value) > maxKeyFileBytes {
		return nil, fmt.Errorf("encryption key file %q is invalid; restore the original key", keyPath)
	}
	vault, err := NewVault(strings.TrimSpace(string(value)))
	if err != nil {
		return nil, fmt.Errorf("encryption key file %q is invalid; restore the original key: %w", keyPath, err)
	}
	return vault, nil
}

// createVaultFile publishes a complete private key without replacing another initializer's key.
func createVaultFile(keyPath string) (*Vault, error) {
	key := make([]byte, vaultKeyBytes)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate encryption key: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(keyPath), ".vault-*.key")
	if err != nil {
		return nil, fmt.Errorf("create encryption key file beside %q: %w", keyPath, err)
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.WriteString(base64.StdEncoding.EncodeToString(key)); err != nil {
		return nil, fmt.Errorf("write encryption key file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return nil, fmt.Errorf("sync encryption key file: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close encryption key file: %w", err)
	}
	if err := os.Link(file.Name(), keyPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			return loadVaultFile(keyPath)
		}
		return nil, fmt.Errorf("publish encryption key file %q: %w", keyPath, err)
	}
	if runtime.GOOS == "linux" {
		directory, err := os.Open(filepath.Dir(keyPath))
		if err != nil {
			return nil, fmt.Errorf("open encryption key directory for sync: %w", err)
		}
		defer directory.Close()
		if err := directory.Sync(); err != nil {
			return nil, fmt.Errorf("sync encryption key directory: %w", err)
		}
	}
	return loadVaultFile(keyPath)
}
