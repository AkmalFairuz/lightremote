package folders

import (
	"errors"
	"fmt"
	"testing"

	"github.com/akmalfairuz/lightremote/internal/model"
)

func folderID(id string) *string {
	return &id
}

func folderChain(length int) []model.Folder {
	folders := make([]model.Folder, 0, length)
	for level := 1; level <= length; level++ {
		folder := model.Folder{ID: fmt.Sprintf("level-%d", level)}
		if level > 1 {
			folder.ParentID = folderID(folders[level-2].ID)
		}
		folders = append(folders, folder)
	}
	return folders
}

func TestValidatePlacementDepth(t *testing.T) {
	if err := validatePlacement(folderChain(15), "", folderID("level-15")); err != nil {
		t.Fatalf("create at level 16: %v", err)
	}
	if err := validatePlacement(folderChain(16), "", folderID("level-16")); !errors.Is(err, ErrDepth) {
		t.Fatalf("create at level 17: got %v, want %v", err, ErrDepth)
	}

	folders := append(folderChain(15),
		model.Folder{ID: "branch"},
		model.Folder{ID: "leaf", ParentID: folderID("branch")},
	)
	if err := validatePlacement(folders, "branch", folderID("level-14")); err != nil {
		t.Fatalf("move subtree ending at level 16: %v", err)
	}
	if err := validatePlacement(folders, "branch", folderID("level-15")); !errors.Is(err, ErrDepth) {
		t.Fatalf("move subtree ending at level 17: got %v, want %v", err, ErrDepth)
	}
	if err := validatePlacement(folders, "level-2", folderID("level-4")); !errors.Is(err, ErrCycle) {
		t.Fatalf("move into descendant: got %v, want %v", err, ErrCycle)
	}
}
