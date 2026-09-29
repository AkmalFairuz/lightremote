package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/jmoiron/sqlx"
)

type ConnectionRepository struct {
	db *sqlx.DB
}

// NewConnectionRepository creates database-backed connection storage.
func NewConnectionRepository(db *sqlx.DB) *ConnectionRepository {
	return &ConnectionRepository{db: db}
}

// List returns an account's saved connections.
func (r *ConnectionRepository) List(ctx context.Context, ownerID string) ([]model.Connection, error) {
	connections := []model.Connection{}
	err := r.db.SelectContext(ctx, &connections,
		"SELECT * FROM connections WHERE user_id = ? ORDER BY name", ownerID)
	for index := range connections {
		connections[index].Proxy = connections[index].PublicProxy()
	}
	return connections, err
}

// Get loads one owned connection, including its encrypted secret.
func (r *ConnectionRepository) Get(ctx context.Context, ownerID, id string) (model.Connection, error) {
	var connection model.Connection
	err := r.db.GetContext(ctx, &connection,
		"SELECT * FROM connections WHERE user_id = ? AND id = ?", ownerID, id)
	connection.Proxy = connection.PublicProxy()
	return connection, err
}

// Create inserts a saved connection.
func (r *ConnectionRepository) Create(ctx context.Context, c model.Connection) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO connections
			(id, user_id, folder_id, name, kind, host, port, username, auth_type,
			 ftp_tls, vnc_encoding, vnc_read_only, vnc_file_transfer, secret, proxy_type, proxy_host, proxy_port, proxy_username,
			 proxy_secret, host_key, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.UserID, c.FolderID, c.Name, c.Kind, c.Host, c.Port,
		c.Username, c.AuthType, c.FTPTLS, c.VNCEncoding, c.VNCReadOnly, c.VNCFileTransfer, c.Secret, c.ProxyType,
		c.ProxyHost, c.ProxyPort, c.ProxyUser, c.ProxySecret, c.HostKey,
		c.CreatedAt, c.UpdatedAt)
	return err
}

// Update persists a saved connection.
func (r *ConnectionRepository) Update(ctx context.Context, c model.Connection) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE connections
		SET folder_id = ?, name = ?, kind = ?, host = ?, port = ?, username = ?,
			auth_type = ?, ftp_tls = ?, vnc_encoding = ?, vnc_read_only = ?, vnc_file_transfer = ?,
			secret = ?, proxy_type = ?, proxy_host = ?,
			proxy_port = ?, proxy_username = ?, proxy_secret = ?, host_key = ?, updated_at = ?
		WHERE id = ? AND user_id = ?`,
		c.FolderID, c.Name, c.Kind, c.Host, c.Port, c.Username, c.AuthType,
		c.FTPTLS, c.VNCEncoding, c.VNCReadOnly, c.VNCFileTransfer, c.Secret, c.ProxyType, c.ProxyHost, c.ProxyPort,
		c.ProxyUser, c.ProxySecret, c.HostKey, c.UpdatedAt, c.ID, c.UserID)
	return err
}

// MoveToFolder changes a connection's folder without modifying its remote settings.
func (r *ConnectionRepository) MoveToFolder(ctx context.Context, ownerID, id string, folderID *string, updatedAt time.Time) error {
	result, err := r.db.ExecContext(ctx,
		"UPDATE connections SET folder_id = ?, updated_at = ? WHERE user_id = ? AND id = ?",
		folderID, updatedAt, ownerID, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// Rename changes only a connection's display name.
func (r *ConnectionRepository) Rename(ctx context.Context, ownerID, id, name string, updatedAt time.Time) error {
	result, err := r.db.ExecContext(ctx,
		"UPDATE connections SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?",
		name, updatedAt, ownerID, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// Delete removes one owned connection.
func (r *ConnectionRepository) Delete(ctx context.Context, ownerID, id string) (bool, error) {
	result, err := r.db.ExecContext(ctx,
		"DELETE FROM connections WHERE user_id = ? AND id = ?", ownerID, id)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

// SetHostKey stores an approved SSH host-key fingerprint.
func (r *ConnectionRepository) SetHostKey(ctx context.Context, ownerID, id, fingerprint string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE connections SET host_key = ?, updated_at = ?
		WHERE user_id = ? AND id = ?`,
		fingerprint, time.Now().UTC(), ownerID, id)
	return err
}
