package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/go-chi/chi/v5"
)

type ConnectionHandler struct {
	service  *connections.Service
	sessions *work.Manager
	timeout  time.Duration
}

// NewConnectionHandler wires saved connection management and SSH trust approval.
func NewConnectionHandler(service *connections.Service, sessions *work.Manager, timeout time.Duration) *ConnectionHandler {
	return &ConnectionHandler{service: service, sessions: sessions, timeout: timeout}
}

// List returns saved connections owned by the current account.
func (h *ConnectionHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.List(r.Context(), principal(r).User.ID)
	if err != nil {
		writeError(w, 500, "internal", "could not list connections")
		return
	}
	writeJSON(w, 200, items)
}

// Get returns one connection without its encrypted credentials.
func (h *ConnectionHandler) Get(w http.ResponseWriter, r *http.Request) {
	connection, err := h.service.Public(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"))
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	writeJSON(w, 200, connection)
}

// Create saves a connection and encrypts any supplied credentials.
func (h *ConnectionHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input model.ConnectionInput
	if !readJSON(w, r, &input) {
		return
	}
	connection, err := h.service.Create(r.Context(), principal(r).User.ID, input)
	if errors.Is(err, connections.ErrInvalid) || errors.Is(err, folders.ErrInvalid) {
		writeError(w, 400, "invalid_connection", err.Error())
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not create connection")
		return
	}
	writeJSON(w, 201, connection)
}

// Duplicate creates a new owned connection with separately encrypted credentials.
func (h *ConnectionHandler) Duplicate(w http.ResponseWriter, r *http.Request) {
	connection, err := h.service.Duplicate(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not duplicate connection")
		return
	}
	writeJSON(w, 201, connection)
}

// Update replaces connection settings and closes active work sessions.
func (h *ConnectionHandler) Update(w http.ResponseWriter, r *http.Request) {
	var input model.ConnectionInput
	if !readJSON(w, r, &input) {
		return
	}
	id := chi.URLParam(r, "connectionID")
	connection, err := h.service.Update(r.Context(), principal(r).User.ID, id, input)
	if errors.Is(err, connections.ErrInvalid) || errors.Is(err, folders.ErrInvalid) {
		writeError(w, 400, "invalid_connection", err.Error())
		return
	}
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	h.sessions.CloseConnection(id)
	writeJSON(w, 200, connection)
}

// MoveToFolder reassigns an owned connection without changing its live sessions.
func (h *ConnectionHandler) MoveToFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FolderID *string `json:"folderId"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	connection, err := h.service.MoveToFolder(r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"), input.FolderID)
	if errors.Is(err, folders.ErrInvalid) {
		writeError(w, 400, "invalid_folder", "invalid folder")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not move connection")
		return
	}
	writeJSON(w, 200, connection)
}

// Rename changes an owned connection's label without closing its work sessions.
func (h *ConnectionHandler) Rename(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	connection, err := h.service.Rename(r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"), input.Name)
	if errors.Is(err, connections.ErrInvalid) {
		writeError(w, 400, "invalid_connection", "invalid connection name")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "could not rename connection")
		return
	}
	writeJSON(w, 200, connection)
}

// Delete removes a connection and closes its live work sessions.
func (h *ConnectionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "connectionID")
	deleted, err := h.service.Delete(r.Context(), principal(r).User.ID, id)
	if err != nil {
		writeError(w, 500, "internal", "could not delete connection")
		return
	}
	if !deleted {
		writeError(w, 404, "not_found", "connection not found")
		return
	}
	h.sessions.CloseConnection(id)
	w.WriteHeader(http.StatusNoContent)
}

// InspectHostKey returns the currently observed SSH or SFTP server fingerprint.
func (h *ConnectionHandler) InspectHostKey(w http.ResponseWriter, r *http.Request) {
	connection, ok := h.sshConnection(w, r)
	if !ok {
		return
	}
	secret, err := h.service.Credentials(connection)
	if err != nil {
		writeError(w, 500, "internal", "could not decrypt credentials")
		return
	}
	fingerprint, err := remote.InspectSSHHostKey(r.Context(), connection, secret, h.timeout)
	if err != nil {
		writeError(w, 502, "remote_error", fmt.Sprintf("could not inspect SSH host key: %v", err))
		return
	}
	writeJSON(w, 200, map[string]string{"fingerprint": fingerprint})
}

// ApproveHostKey pins the observed fingerprint after the user confirms it.
func (h *ConnectionHandler) ApproveHostKey(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Fingerprint string `json:"fingerprint"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	connection, ok := h.sshConnection(w, r)
	if !ok {
		return
	}
	secret, err := h.service.Credentials(connection)
	if err != nil {
		writeError(w, 500, "internal", "could not decrypt credentials")
		return
	}
	observed, err := remote.InspectSSHHostKey(r.Context(), connection, secret, h.timeout)
	if err != nil {
		writeError(w, 502, "remote_error", fmt.Sprintf("could not inspect SSH host key: %v", err))
		return
	}
	// Only pin the fingerprint the user saw if the server still presents it.
	if input.Fingerprint != observed {
		writeError(w, 409, "host_key_changed", "fingerprint does not match current server")
		return
	}
	err = h.service.ApproveHostKey(r.Context(), principal(r).User.ID, connection.ID, observed)
	if err != nil {
		writeError(w, 500, "internal", "could not approve host key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sshConnection loads an owned SSH or SFTP configuration for host-key actions.
func (h *ConnectionHandler) sshConnection(w http.ResponseWriter, r *http.Request) (model.Connection, bool) {
	connection, err := h.service.Get(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"))
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return model.Connection{}, false
	}
	if connection.Kind != "ssh" && connection.Kind != "sftp" {
		writeError(w, 400, "invalid_connection", "SSH or SFTP connection required")
		return model.Connection{}, false
	}
	return connection, true
}
