package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/akmalfairuz/lightremote/internal/sshkeys"
	"github.com/go-chi/chi/v5"
)

type SSHKeyHandler struct {
	service *sshkeys.Service
}

func NewSSHKeyHandler(service *sshkeys.Service) *SSHKeyHandler {
	return &SSHKeyHandler{service: service}
}

func (h *SSHKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	keys, err := h.service.List(r.Context(), principal(r).User.ID)
	if err != nil {
		writeError(w, 500, "internal", "could not list SSH keys")
		return
	}
	writeJSON(w, 200, keys)
}

func (h *SSHKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input sshkeys.Input
	if !readJSON(w, r, &input) {
		return
	}
	key, err := h.service.Create(r.Context(), principal(r).User.ID, input)
	if errors.Is(err, sshkeys.ErrInvalid) {
		writeError(w, 400, "invalid_ssh_key", "Enter a name and a valid private key with its passphrase")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not create SSH key")
		return
	}
	writeJSON(w, 201, key)
}

// Generate returns a key pair without adding it to the account's saved keys.
func (h *SSHKeyHandler) Generate(w http.ResponseWriter, r *http.Request) {
	var input sshkeys.GenerateInput
	if !readJSON(w, r, &input) {
		return
	}
	generated, err := sshkeys.Generate(input)
	if errors.Is(err, sshkeys.ErrInvalid) {
		writeError(w, 400, "invalid_ssh_key", "Enter a name and supported SSH key algorithm")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not generate SSH key")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, generated)
}

func (h *SSHKeyHandler) Rename(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	key, err := h.service.Rename(r.Context(), principal(r).User.ID, chi.URLParam(r, "keyID"), input.Name)
	if errors.Is(err, sshkeys.ErrInvalid) {
		writeError(w, 400, "invalid_ssh_key", "Enter a valid key name")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "SSH key not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not rename SSH key")
		return
	}
	writeJSON(w, 200, key)
}

func (h *SSHKeyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	err := h.service.Delete(r.Context(), principal(r).User.ID, chi.URLParam(r, "keyID"))
	if errors.Is(err, sshkeys.ErrInUse) {
		writeError(w, 409, "ssh_key_in_use", "Change connections using this key before deleting it")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "SSH key not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not delete SSH key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
