package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/go-chi/chi/v5"
)

type FolderHandler struct {
	service *folders.Service
}

// NewFolderHandler wires owner-scoped folder endpoints.
func NewFolderHandler(service *folders.Service) *FolderHandler {
	return &FolderHandler{service: service}
}

// List returns an account's folders.
func (h *FolderHandler) List(w http.ResponseWriter, r *http.Request) {
	folders, err := h.service.List(r.Context(), principal(r).User.ID)
	if err != nil {
		writeError(w, 500, "internal", "could not list folders")
		return
	}
	writeJSON(w, 200, folders)
}

// Create adds a folder beneath an optional parent.
func (h *FolderHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parentId"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	folder, err := h.service.Create(r.Context(), principal(r).User.ID, input.Name, input.ParentID)
	if errors.Is(err, folders.ErrInvalid) {
		writeError(w, 400, "invalid_folder", "invalid folder or parent")
		return
	}
	if errors.Is(err, folders.ErrDepth) {
		writeError(w, 400, "folder_depth", err.Error())
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not create folder")
		return
	}
	writeJSON(w, 201, folder)
}

// Update renames or moves a folder while preventing nesting cycles.
func (h *FolderHandler) Update(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parentId"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	folder, err := h.service.Update(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "folderID"),
		input.Name, input.ParentID)
	if errors.Is(err, folders.ErrInvalid) || errors.Is(err, folders.ErrCycle) || errors.Is(err, folders.ErrDepth) {
		writeError(w, 400, "invalid_folder", err.Error())
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "folder not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not update folder")
		return
	}
	writeJSON(w, 200, folder)
}

// Delete removes an empty folder.
func (h *FolderHandler) Delete(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.service.Delete(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "folderID"))
	if err != nil {
		writeError(w, 409, "folder_not_empty", "folder contains child folders")
		return
	}
	if !deleted {
		writeError(w, 404, "not_found", "folder not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
