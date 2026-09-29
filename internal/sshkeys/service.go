package sshkeys

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/ssh"
)

var ErrInvalid = errors.New("invalid SSH key")
var ErrInUse = errors.New("SSH key is used by a saved connection")

type Key struct {
	ID        string    `db:"id" json:"id"`
	UserID    string    `db:"user_id" json:"-"`
	Name      string    `db:"name" json:"name"`
	Secret    []byte    `db:"secret" json:"-"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

type Input struct {
	Name       string `json:"name"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
}

type Service struct {
	db    *sqlx.DB
	vault *security.Vault
}

func NewService(db *sqlx.DB, vault *security.Vault) *Service {
	return &Service{db: db, vault: vault}
}

func validName(name string) bool {
	return strings.TrimSpace(name) != "" && len(name) <= 255 && !strings.ContainsAny(name, "\x00\r\n")
}

func (s *Service) List(ctx context.Context, ownerID string) ([]Key, error) {
	keys := []Key{}
	err := s.db.SelectContext(ctx, &keys, "SELECT * FROM ssh_keys WHERE user_id = ? ORDER BY name, id", ownerID)
	return keys, err
}

func (s *Service) Create(ctx context.Context, ownerID string, input Input) (Key, error) {
	if !validName(input.Name) || len(input.PrivateKey) == 0 || len(input.PrivateKey) > 512*1024 {
		return Key{}, ErrInvalid
	}
	var err error
	if input.Passphrase == "" {
		_, err = ssh.ParsePrivateKey([]byte(input.PrivateKey))
	} else {
		_, err = ssh.ParsePrivateKeyWithPassphrase([]byte(input.PrivateKey), []byte(input.Passphrase))
	}
	if err != nil {
		return Key{}, ErrInvalid
	}
	key := Key{
		ID:        uuid.NewString(),
		UserID:    ownerID,
		Name:      input.Name,
		CreatedAt: time.Now().UTC(),
	}
	key.Secret, err = s.vault.SealCredentials(key.ID, model.RemoteSecret{
		PrivateKey: input.PrivateKey,
		Passphrase: input.Passphrase,
	})
	if err != nil {
		return Key{}, err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO ssh_keys(id, user_id, name, secret, created_at) VALUES (?, ?, ?, ?, ?)",
		key.ID, key.UserID, key.Name, key.Secret, key.CreatedAt)
	if err != nil {
		return Key{}, err
	}
	return key, nil
}

func (s *Service) Rename(ctx context.Context, ownerID, id, name string) (Key, error) {
	if !validName(name) {
		return Key{}, ErrInvalid
	}
	result, err := s.db.ExecContext(ctx, "UPDATE ssh_keys SET name = ? WHERE id = ? AND user_id = ?", name, id, ownerID)
	if err != nil {
		return Key{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Key{}, err
	}
	if count == 0 {
		return Key{}, sql.ErrNoRows
	}
	return s.Get(ctx, ownerID, id)
}

func (s *Service) Get(ctx context.Context, ownerID, id string) (Key, error) {
	var key Key
	err := s.db.GetContext(ctx, &key, "SELECT * FROM ssh_keys WHERE id = ? AND user_id = ?", id, ownerID)
	return key, err
}

func (s *Service) Credentials(ctx context.Context, ownerID, id string) (model.RemoteSecret, error) {
	key, err := s.Get(ctx, ownerID, id)
	if err != nil {
		return model.RemoteSecret{}, err
	}
	return s.vault.OpenCredentials(model.Connection{ID: key.ID, Secret: key.Secret})
}

func (s *Service) Delete(ctx context.Context, ownerID, id string) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.GetContext(ctx, &count,
		"SELECT COUNT(*) FROM connections WHERE user_id = ? AND ssh_key_id = ?", ownerID, id); err != nil {
		return err
	}
	if count > 0 {
		return ErrInUse
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM ssh_keys WHERE user_id = ? AND id = ?", ownerID, id)
	if err != nil {
		return err
	}
	count64, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count64 == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

// MigrateLegacy moves each stored private key into a reusable encrypted record.
// All changes are committed together, so startup can safely retry after failure.
func (s *Service) MigrateLegacy(ctx context.Context) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var connections []struct {
		ID     string `db:"id"`
		UserID string `db:"user_id"`
		Name   string `db:"name"`
		Secret []byte `db:"secret"`
	}
	if err := tx.SelectContext(ctx, &connections, `
		SELECT id, user_id, name, secret FROM connections
		WHERE auth_type = 'private_key' AND ssh_key_id IS NULL AND secret IS NOT NULL
		ORDER BY user_id, name, id`); err != nil {
		return err
	}
	type identity struct {
		userID     string
		privateKey string
		passphrase string
	}
	seen := make(map[identity]string)
	usedNames := make(map[string]map[string]bool)
	var existing []struct {
		UserID string `db:"user_id"`
		Name   string `db:"name"`
	}
	if err := tx.SelectContext(ctx, &existing, "SELECT user_id, name FROM ssh_keys"); err != nil {
		return err
	}
	for _, key := range existing {
		if usedNames[key.UserID] == nil {
			usedNames[key.UserID] = make(map[string]bool)
		}
		usedNames[key.UserID][key.Name] = true
	}
	for _, connection := range connections {
		secret, err := s.vault.OpenCredentials(model.Connection{ID: connection.ID, Secret: connection.Secret})
		if err != nil {
			return fmt.Errorf("migrate private key for connection %s: %w", connection.ID, err)
		}
		if secret.PrivateKey == "" {
			return fmt.Errorf("connection %s has no private key", connection.ID)
		}
		keyIdentity := identity{
			userID:     connection.UserID,
			privateKey: secret.PrivateKey,
			passphrase: secret.Passphrase,
		}
		keyID := seen[keyIdentity]
		if keyID == "" {
			keyID = uuid.NewString()
			if usedNames[connection.UserID] == nil {
				usedNames[connection.UserID] = make(map[string]bool)
			}
			name := connection.Name
			for suffix := 2; usedNames[connection.UserID][name] || len(name) > 255; suffix++ {
				extra := fmt.Sprintf(" (%d)", suffix)
				base := connection.Name
				for len(base)+len(extra) > 255 {
					_, size := utf8.DecodeLastRuneInString(base)
					base = base[:len(base)-size]
				}
				name = base + extra
			}
			usedNames[connection.UserID][name] = true
			encrypted, err := s.vault.SealCredentials(keyID, model.RemoteSecret{
				PrivateKey: secret.PrivateKey,
				Passphrase: secret.Passphrase,
			})
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO ssh_keys(id, user_id, name, secret, created_at) VALUES (?, ?, ?, ?, ?)",
				keyID, connection.UserID, name, encrypted, time.Now().UTC()); err != nil {
				return err
			}
			seen[keyIdentity] = keyID
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE connections SET ssh_key_id = ?, secret = NULL WHERE id = ? AND user_id = ?",
			keyID, connection.ID, connection.UserID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
