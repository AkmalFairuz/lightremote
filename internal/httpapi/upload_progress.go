package httpapi

import (
	"net/http"
	"sync/atomic"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type uploadProgressKey struct {
	ownerID      string
	connectionID string
	transferID   string
}

func progressKey(r *http.Request) uploadProgressKey {
	return uploadProgressKey{
		ownerID:      principal(r).User.ID,
		connectionID: chi.URLParam(r, "connectionID"),
		transferID:   r.URL.Query().Get("transfer"),
	}
}

// UploadProgress reports bytes delivered by an active remote upload. Entries
// exist only for the request's lifetime and are scoped to its authenticated user.
func (h *FileHandler) UploadProgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	key := progressKey(r)
	if _, err := uuid.Parse(key.transferID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_transfer", "invalid upload transfer ID")
		return
	}
	var loaded int64
	if value, ok := h.uploads.Load(key); ok {
		loaded = value.(*atomic.Int64).Load()
	}
	writeJSON(w, http.StatusOK, map[string]int64{"loaded": loaded})
}

func (h *FileHandler) trackUpload(w http.ResponseWriter, r *http.Request) (func(int64), func(), bool) {
	if r.URL.Query().Get("transfer") == "" {
		return nil, func() {}, true
	}
	key := progressKey(r)
	if _, err := uuid.Parse(key.transferID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_transfer", "invalid upload transfer ID")
		return nil, nil, false
	}
	loaded := &atomic.Int64{}
	if _, exists := h.uploads.LoadOrStore(key, loaded); exists {
		writeError(w, http.StatusConflict, "transfer_active", "upload transfer ID is already active")
		return nil, nil, false
	}
	return loaded.Store, func() { h.uploads.Delete(key) }, true
}
