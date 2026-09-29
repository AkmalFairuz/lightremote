package desktopdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVaultKeyPersistsAndMissingKeyDoesNotReplaceIt(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "vault.key")
	dbPath := filepath.Join(dir, "lightremote.db")
	first, err := loadOrCreateKey(keyPath, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadOrCreateKey(keyPath, dbPath)
	if err != nil || first != second {
		t.Fatalf("vault key changed across launches: %v", err)
	}
	if err := os.WriteFile(dbPath, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreateKey(keyPath, dbPath); err == nil {
		t.Fatal("missing key for existing database must fail")
	}
}
