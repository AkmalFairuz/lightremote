package sshkeys

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
)

func TestManagedKeysMigrateAndProtectReferences(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "keys.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	vault, err := security.NewVault(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, vault)
	now := time.Now().UTC()
	for _, userID := range []string{"user-1", "user-2"} {
		if err := store.NewUserRepository(db).Create(ctx, model.User{
			ID:           userID,
			Email:        userID + "@example.com",
			PasswordHash: "hash",
			Role:         "user",
			CreatedAt:    now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	privateKey, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	keyText := string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}))
	for _, id := range []string{"connection-1", "connection-2"} {
		secret, err := vault.SealCredentials(id, model.RemoteSecret{PrivateKey: keyText})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.NewConnectionRepository(db).Create(ctx, model.Connection{
			ID:        id,
			UserID:    "user-1",
			Name:      id,
			Kind:      "ssh",
			Host:      "example.com",
			Port:      22,
			Username:  "alice",
			AuthType:  "private_key",
			Secret:    secret,
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := service.MigrateLegacy(ctx); err != nil {
			t.Fatal(err)
		}
	}
	keys, err := service.List(ctx, "user-1")
	if err != nil || len(keys) != 1 {
		t.Fatalf("expected one deduplicated key: %d, %v", len(keys), err)
	}
	if string(keys[0].Secret) == keyText {
		t.Fatal("private key was not encrypted")
	}
	for _, id := range []string{"connection-1", "connection-2"} {
		connection, err := store.NewConnectionRepository(db).Get(ctx, "user-1", id)
		if err != nil || connection.SSHKeyID == nil || *connection.SSHKeyID != keys[0].ID || len(connection.Secret) != 0 {
			t.Fatalf("connection %s was not migrated: %+v, %v", id, connection, err)
		}
	}
	secret, err := service.Credentials(ctx, "user-1", keys[0].ID)
	if err != nil || secret.PrivateKey != keyText {
		t.Fatalf("could not resolve migrated key: %v", err)
	}
	if _, err := service.Credentials(ctx, "user-2", keys[0].ID); err == nil {
		t.Fatal("other account could read SSH key")
	}
	if err := service.Delete(ctx, "user-1", keys[0].ID); !errors.Is(err, ErrInUse) {
		t.Fatalf("referenced key deletion: %v", err)
	}
	created, err := service.Create(ctx, "user-2", Input{
		Name:       "New key",
		PrivateKey: keyText,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Rename(ctx, "user-1", created.ID, "Other name"); err == nil {
		t.Fatal("other account renamed SSH key")
	}
}
