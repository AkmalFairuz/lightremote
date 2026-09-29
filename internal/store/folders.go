package store

import (
	"context"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/jmoiron/sqlx"
)

type FolderRepository struct {
	db *sqlx.DB
}

// NewFolderRepository creates database-backed folder storage.
func NewFolderRepository(db *sqlx.DB) *FolderRepository {
	return &FolderRepository{db: db}
}

// List returns folders belonging to one account.
func (r *FolderRepository) List(ctx context.Context, ownerID string) ([]model.Folder, error) {
	folders := []model.Folder{}
	err := r.db.SelectContext(ctx, &folders,
		"SELECT * FROM folders WHERE user_id = ? ORDER BY name", ownerID)
	return folders, err
}

// Get loads one owned folder.
func (r *FolderRepository) Get(ctx context.Context, ownerID, id string) (model.Folder, error) {
	var folder model.Folder
	err := r.db.GetContext(ctx, &folder,
		"SELECT * FROM folders WHERE user_id = ? AND id = ?", ownerID, id)
	return folder, err
}

// Create inserts a folder.
func (r *FolderRepository) Create(ctx context.Context, folder model.Folder) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO folders(id, user_id, parent_id, name, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		folder.ID, folder.UserID, folder.ParentID, folder.Name, folder.CreatedAt)
	return err
}

// Update persists a folder's name and parent.
func (r *FolderRepository) Update(ctx context.Context, folder model.Folder) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE folders SET parent_id = ?, name = ? WHERE id = ? AND user_id = ?`,
		folder.ParentID, folder.Name, folder.ID, folder.UserID)
	return err
}

// Delete removes an owned folder if referential constraints permit it.
func (r *FolderRepository) Delete(ctx context.Context, ownerID, id string) (bool, error) {
	result, err := r.db.ExecContext(ctx,
		"DELETE FROM folders WHERE id = ? AND user_id = ?", id, ownerID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}
