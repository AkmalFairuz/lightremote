package folders

import "github.com/akmalfairuz/lightremote/internal/model"

const maxFolderDepth = 16

// validatePlacement checks the folder's future depth and its deepest descendant.
func validatePlacement(folders []model.Folder, folderID string, parentID *string) error {
	byID := make(map[string]model.Folder, len(folders))
	children := make(map[string][]string)
	for _, folder := range folders {
		byID[folder.ID] = folder
		if folder.ParentID != nil {
			children[*folder.ParentID] = append(children[*folder.ParentID], folder.ID)
		}
	}

	depth := 1
	seen := map[string]bool{folderID: true}
	for parentID != nil {
		if seen[*parentID] {
			return ErrCycle
		}
		seen[*parentID] = true
		parent, exists := byID[*parentID]
		if !exists {
			return ErrInvalid
		}
		depth++
		if depth > maxFolderDepth {
			return ErrDepth
		}
		parentID = parent.ParentID
	}

	if folderID == "" {
		return nil
	}
	type descendant struct {
		id    string
		level int
	}
	queue := []descendant{{id: folderID, level: 1}}
	visited := make(map[string]bool)
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if visited[current.id] {
			return ErrCycle
		}
		visited[current.id] = true
		if depth+current.level-1 > maxFolderDepth {
			return ErrDepth
		}
		for _, childID := range children[current.id] {
			queue = append(queue, descendant{id: childID, level: current.level + 1})
		}
	}
	return nil
}
