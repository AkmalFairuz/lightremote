package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/connections"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/remote"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/go-chi/chi/v5"
)

type FileHandler struct {
	connections *connections.Service
	dialTimeout time.Duration
	maxUpload   int64
	sessions    *work.Manager
}

// NewFileHandler wires streaming remote file operations.
func NewFileHandler(connections *connections.Service, sessions *work.Manager, dialTimeout time.Duration, maxUpload int64) *FileHandler {
	return &FileHandler{
		connections: connections,
		dialTimeout: dialTimeout,
		maxUpload:   maxUpload,
		sessions:    sessions,
	}
}

// List returns one remote directory.
func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	client, remotePath, ok := h.open(w, r, "path")
	if !ok {
		return
	}
	defer client.Close()
	entries, err := client.List(remotePath)
	if err != nil {
		writeRemoteError(w, err, "could not list remote directory")
		return
	}
	writeJSON(w, 200, entries)
}

// Home returns the remote starting directory for a file connection.
func (h *FileHandler) Home(w http.ResponseWriter, r *http.Request) {
	client, ok := h.openClient(w, r)
	if !ok {
		return
	}
	defer client.Close()
	home := "/"
	if provider, ok := client.(interface{ Home() (string, error) }); ok {
		var err error
		home, err = provider.Home()
		if err != nil {
			writeRemoteError(w, err, "could not resolve remote home directory")
			return
		}
	}
	cleaned, err := remote.CleanRemotePath(home)
	if err != nil {
		writeError(w, 502, "remote_error", "remote home directory is invalid")
		return
	}
	writeJSON(w, 200, map[string]string{"path": cleaned})
}

// Download streams one remote file to the browser.
func (h *FileHandler) Download(w http.ResponseWriter, r *http.Request) {
	client, remotePath, ok := h.open(w, r, "path")
	if !ok {
		return
	}
	defer client.Close()
	if remotePath == "/" {
		writeError(w, 400, "invalid_path", "a file path is required")
		return
	}
	source, err := client.Download(remotePath)
	if err != nil {
		writeRemoteError(w, err, "could not open remote file")
		return
	}
	defer source.Close()
	filename := strings.ReplaceAll(path.Base(remotePath), "\"", "")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	_, _ = io.Copy(w, source)
}

// Upload streams the request body directly to a remote file.
func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > h.maxUpload {
		writeError(w, 413, "too_large", "upload exceeds configured limit")
		return
	}
	client, remotePath, ok := h.open(w, r, "path")
	if !ok {
		return
	}
	defer client.Close()
	if remotePath == "/" {
		writeError(w, 400, "invalid_path", "a file path is required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxUpload)
	defer r.Body.Close()
	if err := client.Upload(remotePath, r.Body); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(w, 413, "too_large", "upload exceeds configured limit")
			return
		}
		writeRemoteError(w, err, "could not upload remote file")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Mkdir creates one remote directory.
func (h *FileHandler) Mkdir(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	h.perform(w, r, input.Path, func(client remote.FileClient, remotePath string) error {
		return client.Mkdir(remotePath)
	})
}

// Rename moves or renames one remote entry.
func (h *FileHandler) Rename(w http.ResponseWriter, r *http.Request) {
	var input struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	newPath, err := remote.CleanRemotePath(input.NewPath)
	if err != nil || newPath == "/" {
		writeError(w, 400, "invalid_path", "invalid destination path")
		return
	}
	h.perform(w, r, input.OldPath, func(client remote.FileClient, oldPath string) error {
		return client.Rename(oldPath, newPath)
	})
}

// Delete removes one remote file or empty directory.
func (h *FileHandler) Delete(w http.ResponseWriter, r *http.Request) {
	h.perform(w, r, r.URL.Query().Get("path"),
		func(client remote.FileClient, remotePath string) error {
			return client.Delete(remotePath)
		})
}

// perform validates a mutating file path and runs one remote operation.
func (h *FileHandler) perform(w http.ResponseWriter, r *http.Request, inputPath string, operation func(remote.FileClient, string) error) {
	remotePath, err := remote.CleanRemotePath(inputPath)
	if err != nil || remotePath == "/" {
		writeError(w, 400, "invalid_path", "a non-root absolute path is required")
		return
	}
	client, ok := h.openClient(w, r)
	if !ok {
		return
	}
	defer client.Close()
	if err := operation(client, remotePath); err != nil {
		writeRemoteError(w, err, "remote operation failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// open resolves a query path and opens the authorized file connection.
func (h *FileHandler) open(w http.ResponseWriter, r *http.Request, queryField string) (remote.FileClient, string, bool) {
	remotePath, err := remote.CleanRemotePath(r.URL.Query().Get(queryField))
	if err != nil {
		writeError(w, 400, "invalid_path", err.Error())
		return nil, "", false
	}
	client, ok := h.openClient(w, r)
	return client, remotePath, ok
}

// openClient selects the active VNC bridge or a short-lived remote file client.
func (h *FileHandler) openClient(w http.ResponseWriter, r *http.Request) (remote.FileClient, bool) {
	connection, err := h.connections.Get(
		r.Context(), principal(r).User.ID, chi.URLParam(r, "connectionID"))
	if err != nil {
		writeError(w, 404, "not_found", "connection not found")
		return nil, false
	}
	if connection.Kind == "ssh" {
		writeError(w, 400, "invalid_connection", "use an SFTP connection for SSH files")
		return nil, false
	}
	if connection.Kind == "vnc" && !connection.VNCFileTransfer {
		writeError(w, http.StatusForbidden, "file_transfer_disabled", "file transfer is disabled for this VNC connection")
		return nil, false
	}
	if connection.Kind == "vnc" {
		if client, starting := h.sessions.FileClientForConnection(principal(r).User.ID, connection.ID); client != nil {
			return client, true
		} else if starting {
			writeError(w, 409, "session_starting", "VNC desktop is still connecting")
			return nil, false
		}
	}
	secret, err := h.connections.Credentials(connection)
	if err != nil {
		writeError(w, 500, "internal", "could not decrypt credentials")
		return nil, false
	}
	client, err := h.dial(r, connection, secret)
	if err != nil {
		writeRemoteError(w, err, err.Error())
		return nil, false
	}
	return client, true
}

// dial creates a file-only VNC bridge or a standalone SFTP/FTP client.
func (h *FileHandler) dial(r *http.Request, connection model.Connection, secret model.RemoteSecret) (remote.FileClient, error) {
	if connection.Kind == "vnc" {
		bridge, err := remote.NewVNCBridge(r.Context(), connection, secret, h.dialTimeout)
		if err != nil {
			return nil, err
		}
		if err := bridge.StartHeadless(); err != nil {
			bridge.Close()
			return nil, err
		}
		return bridge.Files(true), nil
	}
	return remote.OpenFileClient(r.Context(), connection, secret, h.dialTimeout)
}

// writeRemoteError maps known capability and host-trust errors to API codes.
func writeRemoteError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, remote.ErrUnsupported):
		writeError(w, 501, "unsupported_capability", "remote server does not support this file operation")
	case errors.Is(err, remote.ErrUnapprovedHostKey):
		writeError(w, 409, "host_key_unapproved", "approve the SSH host key before connecting")
	case errors.Is(err, remote.ErrChangedHostKey):
		writeError(w, 409, "host_key_changed", "SSH host key differs from the approved fingerprint")
	default:
		writeError(w, 502, "remote_error", remoteErrorMessage(fallback, err))
	}
}

func remoteErrorMessage(fallback string, err error) string {
	cleaned := strings.Map(func(character rune) rune {
		if unicode.IsControl(character) {
			return ' '
		}
		return character
	}, strings.ToValidUTF8(err.Error(), "�"))
	detail := strings.Join(strings.Fields(cleaned), " ")
	if detail == "" {
		return fallback
	}
	const maxDetailRunes = 400
	if utf8.RuneCountInString(detail) > maxDetailRunes {
		detail = string([]rune(detail)[:maxDetailRunes]) + "…"
	}
	if fallback == "" || fallback == detail {
		return detail
	}
	return fallback + ": " + detail
}
