package security

import (
	"encoding/base64"
	"testing"

	"github.com/akmalfairuz/lightremote/internal/model"
)

func TestVaultBindsCiphertextToConnection(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	vault, err := NewVault(key)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := vault.Seal([]byte("private-key"), "connection-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Open(ciphertext, "connection-b"); err == nil {
		t.Fatal("another connection decrypted this ciphertext")
	}
	plaintext, err := vault.Open(ciphertext, "connection-a")
	if err != nil || string(plaintext) != "private-key" {
		t.Fatalf("original connection could not decrypt: %v", err)
	}
}

func TestProxyPasswordUsesSeparateVaultContext(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	vault, err := NewVault(key)
	if err != nil {
		t.Fatal(err)
	}
	proxySecret, err := vault.SealProxyPassword("connection-a", "proxy-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Open(proxySecret, "connection-a"); err == nil {
		t.Fatal("proxy password decrypted as a remote credential")
	}
	password, err := vault.OpenProxyPassword(model.Connection{ID: "connection-a", ProxySecret: proxySecret})
	if err != nil || password != "proxy-password" {
		t.Fatalf("proxy password could not be decrypted: %v", err)
	}
	if _, err := vault.OpenProxyPassword(model.Connection{ID: "connection-b", ProxySecret: proxySecret}); err == nil {
		t.Fatal("proxy password decrypted for another connection")
	}
}

func TestPasswordHashVerification(t *testing.T) {
	hash, err := HashPassword("123456")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "123456") {
		t.Fatal("correct password was rejected")
	}
	if VerifyPassword(hash, "wrong-password") {
		t.Fatal("wrong password was accepted")
	}
	if _, err := HashPassword("12345"); err == nil {
		t.Fatal("password shorter than six characters was accepted")
	}
}
