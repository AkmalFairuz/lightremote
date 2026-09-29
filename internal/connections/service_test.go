package connections

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/sshkeys"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
)

// TestProxyPasswordUpdate keeps credentials only for the same proxy identity.
func TestProxyPasswordUpdate(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	vault, err := security.NewVault(key)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{vault: vault}
	connection := model.Connection{ID: "connection-a"}
	password := "proxy-password"
	proxy := &model.ProxyInput{Type: "socks5", Host: "proxy.example", Port: 1080, Username: "alice", Password: &password}
	if err := service.applyProxy(&connection, proxy, false); err != nil {
		t.Fatal(err)
	}
	stored := append([]byte(nil), connection.ProxySecret...)
	proxy.Password = nil
	if err := service.applyProxy(&connection, proxy, true); err != nil {
		t.Fatalf("same proxy did not retain password: %v", err)
	}
	if string(stored) != string(connection.ProxySecret) {
		t.Fatal("same proxy lost its encrypted password")
	}
	changed := *proxy
	changed.Host = "other.example"
	if err := service.applyProxy(&connection, &changed, true); err == nil {
		t.Fatal("changed authenticated proxy retained old password")
	}
	if string(stored) != string(connection.ProxySecret) {
		t.Fatal("failed proxy update modified saved password")
	}
	encoded, err := json.Marshal(connection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), password) || strings.Contains(string(encoded), "proxy_secret") {
		t.Fatal("proxy password appeared in connection JSON")
	}
}

func TestManagedSSHKeyWorksForSavedAndDirectConnections(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "connections.db"),
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
	for _, ownerID := range []string{"owner", "other"} {
		if err := store.NewUserRepository(db).Create(ctx, model.User{
			ID:           ownerID,
			Email:        ownerID + "@example.com",
			PasswordHash: "hash",
			Role:         "user",
			CreatedAt:    time.Now().UTC(),
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
	keys := sshkeys.NewService(db, vault)
	key, err := keys.Create(ctx, "owner", sshkeys.Input{
		Name:       "Main key",
		PrivateKey: keyText,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(
		store.NewConnectionRepository(db),
		folders.NewService(store.NewFolderRepository(db)),
		vault,
		keys,
	)
	input := model.ConnectionInput{
		Name:     "Server",
		Kind:     "ssh",
		Host:     "example.com",
		Port:     22,
		Username: "alice",
		AuthType: "private_key",
		SSHKeyID: &key.ID,
	}
	if _, err := service.Create(ctx, "other", input); err == nil {
		t.Fatal("another account used the managed key")
	}
	saved, err := service.Create(ctx, "owner", input)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := service.Get(ctx, "owner", saved.ID)
	if err != nil || len(stored.Secret) != 0 {
		t.Fatalf("saved connection stored a copy of the key: %v", err)
	}
	secret, err := service.Credentials(ctx, stored)
	if err != nil || secret.PrivateKey != keyText {
		t.Fatalf("saved connection did not resolve key: %v", err)
	}
	duplicate, err := service.Duplicate(ctx, "owner", saved.ID)
	if err != nil || duplicate.SSHKeyID == nil || *duplicate.SSHKeyID != key.ID {
		t.Fatalf("duplicate lost key reference: %+v, %v", duplicate, err)
	}
	direct, err := service.CreateDirect(ctx, "owner", input)
	if err != nil {
		t.Fatal(err)
	}
	temporary, err := service.Get(ctx, "owner", direct.ID)
	if err != nil || temporary.SSHKeyID != nil || len(temporary.Secret) == 0 {
		t.Fatalf("direct connection did not copy temporary credentials: %+v, %v", temporary, err)
	}
	secret, err = service.Credentials(ctx, temporary)
	if err != nil || secret.PrivateKey != keyText {
		t.Fatalf("direct connection did not resolve key: %v", err)
	}
	service.DeleteDirect("owner", direct.ID)
}
