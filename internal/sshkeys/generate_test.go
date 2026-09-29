package sshkeys

import (
	"bytes"
	"context"
	"encoding/base64"
	"path/filepath"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
	"golang.org/x/crypto/ssh"
)

func TestGenerateReturnsMatchingPairsWithoutSaving(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "generated-keys.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := store.NewUserRepository(db).Create(ctx, model.User{
		ID:           "owner",
		Email:        "owner@example.com",
		PasswordHash: "hash",
		Role:         "user",
		CreatedAt:    time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	vault, err := security.NewVault(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, vault)
	var first GeneratedKey

	for _, test := range []struct {
		algorithm  string
		passphrase string
	}{
		{algorithm: "ed25519"},
		{algorithm: "ecdsa_p256", passphrase: "secret passphrase"},
		{algorithm: "rsa4096", passphrase: "secret passphrase"},
	} {
		t.Run(test.algorithm, func(t *testing.T) {
			generated, err := Generate(GenerateInput{
				Name:       test.algorithm,
				Algorithm:  test.algorithm,
				Passphrase: test.passphrase,
			})
			if err != nil {
				t.Fatal(err)
			}
			keys, err := service.List(ctx, "owner")
			if err != nil || len(keys) != 0 {
				t.Fatalf("generation saved a key without consent: %v", err)
			}
			if test.algorithm == "ed25519" {
				first = generated
			}
			var signer ssh.Signer
			if test.passphrase == "" {
				signer, err = ssh.ParsePrivateKey([]byte(generated.PrivateKey))
			} else {
				signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(generated.PrivateKey), []byte(test.passphrase))
			}
			if err != nil {
				t.Fatal(err)
			}
			public, _, _, _, err := ssh.ParseAuthorizedKey([]byte(generated.PublicKey))
			if err != nil || !bytes.Equal(public.Marshal(), signer.PublicKey().Marshal()) {
				t.Fatalf("public key does not match private key: %v", err)
			}
		})
	}
	created, err := service.Create(ctx, "owner", Input{
		Name:       "Saved after generation",
		PrivateKey: first.PrivateKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := service.Get(ctx, "owner", created.ID)
	if err != nil || bytes.Contains(stored.Secret, []byte(first.PrivateKey)) {
		t.Fatalf("explicitly saved key was not encrypted: %v", err)
	}
	if _, err := Generate(GenerateInput{
		Name:      "Invalid",
		Algorithm: "unsupported",
	}); err != ErrInvalid {
		t.Fatalf("unsupported algorithm: %v", err)
	}
}
