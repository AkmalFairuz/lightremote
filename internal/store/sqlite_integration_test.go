package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/store/migrations"
	"github.com/jmoiron/sqlx"
)

// TestSQLiteRepositoriesAndMigrations covers persistent records and reversible schema changes.
func TestSQLiteRepositoriesAndMigrations(t *testing.T) {
	ctx := context.Background()
	settings := DatabaseSettings{
		Driver:     "sqlite",
		SQLitePath: filepath.Join(t.TempDir(), "lightremote.db"),
	}
	db, err := Open(ctx, settings)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "ALTER TABLE connections ADD COLUMN vnc_depth INT NOT NULL DEFAULT 24"); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatalf("clean up an already-applied VNC migration: %v", err)
	}
	var obsoleteColumns int
	if err := db.GetContext(ctx, &obsoleteColumns,
		"SELECT COUNT(*) FROM pragma_table_info('connections') WHERE name = 'vnc_depth'"); err != nil {
		t.Fatal(err)
	}
	if obsoleteColumns != 0 {
		t.Fatal("obsolete vnc_depth column remains")
	}
	first, err := db.Connx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := db.Connx(ctx)
	if err != nil {
		first.Close()
		t.Fatal(err)
	}
	defer second.Close()
	for _, conn := range []*sqlx.Conn{first, second} {
		var foreignKeys int
		if err := conn.GetContext(ctx, &foreignKeys, "PRAGMA foreign_keys"); err != nil || foreignKeys != 1 {
			t.Fatalf("SQLite connection has foreign_keys=%d: %v", foreignKeys, err)
		}
	}
	first.Close()
	second.Close()

	users := NewUserRepository(db)
	now := time.Now().UTC()
	for _, id := range []string{"user-1", "user-2"} {
		if err := users.Create(ctx, model.User{
			ID:           id,
			Email:        id + "@example.com",
			PasswordHash: "hash",
			Role:         "user",
			CreatedAt:    now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	renamedUser, err := users.ByID(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	renamedUser.Email = "renamed@example.com"
	if err := users.Update(ctx, renamedUser); err != nil {
		t.Fatalf("update user email: %v", err)
	}
	if _, err := users.ByEmail(ctx, "renamed@example.com"); err != nil {
		t.Fatalf("find updated email: %v", err)
	}
	otherUser, err := users.ByID(ctx, "user-2")
	if err != nil {
		t.Fatal(err)
	}
	otherUser.Email = renamedUser.Email
	if err := users.Update(ctx, otherUser); err == nil {
		t.Fatal("duplicate email was accepted")
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO folders(id, user_id, name, created_at)
		VALUES (?, ?, ?, ?)`, "invalid-folder", "missing-user", "Invalid", now); err == nil {
		t.Fatal("SQLite foreign keys are disabled")
	}

	folders := NewFolderRepository(db)
	if err := folders.Create(ctx, model.Folder{
		ID:        "folder-1",
		UserID:    "user-1",
		Name:      "Servers",
		CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	proxyType := "socks5"
	proxyHost := "proxy.example.com"
	proxyPort := 1080
	connections := NewConnectionRepository(db)
	if err := connections.Create(ctx, model.Connection{
		ID:          "connection-1",
		UserID:      "user-1",
		Name:        "SSH",
		Kind:        "ssh",
		Host:        "ssh.example.com",
		Port:        22,
		Username:    "alice",
		AuthType:    "password",
		Secret:      []byte("encrypted"),
		ProxyType:   &proxyType,
		ProxyHost:   &proxyHost,
		ProxyPort:   &proxyPort,
		ProxySecret: []byte("proxy-encrypted"),
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := connections.Get(ctx, "user-2", "connection-1"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("other user's connection: %v", err)
	}
	folderID := "folder-1"
	if err := connections.MoveToFolder(ctx, "user-2", "connection-1", &folderID, now); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("other user's folder move: %v", err)
	}
	if err := connections.MoveToFolder(ctx, "user-1", "connection-1", &folderID, now); err != nil {
		t.Fatal(err)
	}
	if err := connections.Rename(ctx, "user-2", "connection-1", "Changed", now); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("other user's rename: %v", err)
	}
	if err := connections.Rename(ctx, "user-1", "connection-1", "Renamed SSH", now); err != nil {
		t.Fatal(err)
	}
	moved, err := connections.Get(ctx, "user-1", "connection-1")
	if err != nil || moved.FolderID == nil || *moved.FolderID != folderID || moved.Name != "Renamed SSH" {
		t.Fatalf("connection folder move: %+v, %v", moved, err)
	}
	if err := connections.SetHostKey(ctx, "user-1", "connection-1", "SHA256:fingerprint"); err != nil {
		t.Fatal(err)
	}

	sessions := NewLoginSessionRepository(db)
	validToken := make([]byte, 32)
	expiredToken := make([]byte, 32)
	expiredToken[0] = 1
	if err := sessions.Create(ctx, validToken, LoginSession{
		UserID:    "user-1",
		CSRFToken: "csrf-valid",
		ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if err := sessions.Create(ctx, expiredToken, LoginSession{
		UserID:    "user-1",
		CSRFToken: "csrf-expired",
		ExpiresAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Get(ctx, validToken); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Get(ctx, expiredToken); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expired session: %v", err)
	}
	if err := sessions.DeleteExpired(ctx); err != nil {
		t.Fatal(err)
	}

	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, settings)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatalf("migrate reopened database: %v", err)
	}
	stored, err := NewConnectionRepository(db).Get(ctx, "user-1", "connection-1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Proxy == nil || stored.Proxy.Type != proxyType || stored.HostKey == nil || *stored.HostKey != "SHA256:fingerprint" {
		t.Fatalf("connection did not survive reopen: %+v", stored)
	}
	if err := migrations.Down(ctx, db); err != nil {
		t.Fatalf("rollback recent connections migration: %v", err)
	}
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatalf("reapply recent connections migration: %v", err)
	}
	if err := migrations.Down(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Down(ctx, db); err != nil {
		t.Fatalf("rollback VNC migration: %v", err)
	}
	if err := migrations.Down(ctx, db); err != nil {
		t.Fatalf("rollback proxy migration: %v", err)
	}
	if err := migrations.Down(ctx, db); err != nil {
		t.Fatalf("rollback initial migration: %v", err)
	}
	if err := migrations.Up(ctx, db); err != nil {
		t.Fatalf("recreate schema: %v", err)
	}
}
