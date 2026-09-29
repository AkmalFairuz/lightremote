package folders

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/google/uuid"
)

const maxFolderNameBytes = 255

var ErrInvalid = errors.New("invalid folder")
var ErrCycle = errors.New("folder would contain itself")
var ErrDepth = fmt.Errorf("folder depth cannot exceed %d", maxFolderDepth)

type Service struct {
	repository *store.FolderRepository
}

// NewService creates owner-scoped folder operations.
func NewService(repository *store.FolderRepository) *Service {
	return &Service{repository: repository}
}

// List returns folders owned by one account.
func (s *Service) List(ctx context.Context, ownerID string) ([]model.Folder, error) {
	return s.repository.List(ctx, ownerID)
}

// Create adds a folder beneath an optional owned parent.
func (s *Service) Create(ctx context.Context, ownerID, name string, parentID *string) (model.Folder, error) {
	if strings.TrimSpace(name) == "" || len(name) > maxFolderNameBytes {
		return model.Folder{}, ErrInvalid
	}
	if parentID != nil {
		folders, err := s.repository.List(ctx, ownerID)
		if err != nil {
			return model.Folder{}, err
		}
		if err := validatePlacement(folders, "", parentID); err != nil {
			return model.Folder{}, err
		}
	}
	folder := model.Folder{
		ID:        uuid.NewString(),
		UserID:    ownerID,
		ParentID:  parentID,
		Name:      name,
		CreatedAt: time.Now().UTC(),
	}
	return folder, s.repository.Create(ctx, folder)
}

// Update renames or moves a folder without creating a nesting cycle.
func (s *Service) Update(ctx context.Context, ownerID, id, name string, parentID *string) (model.Folder, error) {
	folder, err := s.repository.Get(ctx, ownerID, id)
	if err != nil {
		return folder, err
	}
	if strings.TrimSpace(name) == "" || len(name) > maxFolderNameBytes {
		return model.Folder{}, ErrInvalid
	}
	folders, err := s.repository.List(ctx, ownerID)
	if err != nil {
		return model.Folder{}, err
	}
	if err := validatePlacement(folders, id, parentID); err != nil {
		return model.Folder{}, err
	}
	folder.Name = name
	folder.ParentID = parentID
	return folder, s.repository.Update(ctx, folder)
}

// Delete removes an owned folder when its child-folder constraint permits it.
func (s *Service) Delete(ctx context.Context, ownerID, id string) (bool, error) {
	return s.repository.Delete(ctx, ownerID, id)
}

// ValidateOwner checks that an optional folder belongs to the account.
func (s *Service) ValidateOwner(ctx context.Context, ownerID string, id *string) error {
	if id == nil {
		return nil
	}
	if _, err := s.repository.Get(ctx, ownerID, *id); err != nil {
		return ErrInvalid
	}
	return nil
}
