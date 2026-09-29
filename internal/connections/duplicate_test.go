package connections

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
)

func TestDuplicateReencryptsConnectionSecrets(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "lightremote.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	const ownerID = "owner-1"
	if err := store.NewUserRepository(db).Create(ctx, model.User{
		ID:           ownerID,
		Email:        "owner@example.com",
		PasswordHash: "hash",
		Role:         "user",
		CreatedAt:    time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	folderService := folders.NewService(store.NewFolderRepository(db))
	folder, err := folderService.Create(ctx, ownerID, "Servers", nil)
	if err != nil {
		t.Fatal(err)
	}
	vault, err := security.NewVault(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store.NewConnectionRepository(db), folderService, vault, nil)
	proxyPassword := "proxy-password"
	source, err := service.Create(ctx, ownerID, model.ConnectionInput{
		FolderID: &folder.ID,
		Name:     "Production",
		Kind:     "ssh",
		Host:     "server.example.com",
		Port:     22,
		Username: "ubuntu",
		AuthType: "private_key",
		Secret: &model.RemoteSecret{
			PrivateKey: "private-key-material",
			Passphrase: "key-passphrase",
		},
		Proxy: &model.ProxyInput{
			Type:     "socks5",
			Host:     "proxy.example.com",
			Port:     1080,
			Username: "proxy-user",
			Password: &proxyPassword,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ApproveHostKey(ctx, ownerID, source.ID, "SHA256:approved"); err != nil {
		t.Fatal(err)
	}

	copy, err := service.Duplicate(ctx, ownerID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if copy.ID == source.ID || copy.Name != "Production copy" || copy.FolderID == nil || *copy.FolderID != folder.ID {
		t.Fatalf("duplicate identity or location: %+v", copy)
	}
	if len(copy.Secret) != 0 || len(copy.ProxySecret) != 0 || copy.Proxy == nil || !copy.Proxy.HasPassword {
		t.Fatal("duplicate response leaked or lost secret metadata")
	}

	storedSource, err := service.Get(ctx, ownerID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedCopy, err := service.Get(ctx, ownerID, copy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(storedSource.Secret, storedCopy.Secret) || bytes.Equal(storedSource.ProxySecret, storedCopy.ProxySecret) {
		t.Fatal("duplicate reused source ciphertext")
	}
	if storedCopy.HostKey == nil || *storedCopy.HostKey != "SHA256:approved" {
		t.Fatal("duplicate lost approved SSH host key")
	}
	remoteSecret, err := vault.OpenCredentials(storedCopy)
	if err != nil || remoteSecret.PrivateKey != "private-key-material" || remoteSecret.Passphrase != "key-passphrase" {
		t.Fatalf("duplicate remote credentials were not preserved: %v", err)
	}
	password, err := vault.OpenProxyPassword(storedCopy)
	if err != nil || password != proxyPassword {
		t.Fatalf("duplicate proxy password was not preserved: %v", err)
	}
	if _, err := vault.Open(storedCopy.Secret, source.ID); err == nil {
		t.Fatal("duplicate remote credentials opened with source ID")
	}
	if _, err := service.Duplicate(ctx, "different-owner", source.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("another owner duplicated connection: %v", err)
	}
}
