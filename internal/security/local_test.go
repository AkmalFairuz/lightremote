package security

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
)

func TestBootstrapLocalUserKeepsStableOwner(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, store.DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "local.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	users := store.NewUserRepository(db)
	first, err := BootstrapLocalUser(ctx, users)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BootstrapLocalUser(ctx, users)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.ID == "" {
		t.Fatalf("local owner changed across startup: %q, %q", first.ID, second.ID)
	}
	if first.Role == "admin" || first.PasswordHash == "" {
		t.Fatalf("unexpected local owner: %+v", first)
	}
	count, err := users.AdminCount(ctx)
	if err != nil || count != 0 {
		t.Fatalf("local mode created an administrator: %d: %v", count, err)
	}
}
