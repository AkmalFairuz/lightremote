package httpapi

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
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
	uploads     sync.Map
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

// DownloadLocal writes a remote file to a desktop-selected destination.
func (h *FileHandler) DownloadLocal(ctx context.Context, ownerID, connectionID, inputPath string, destination io.Writer) error {
	remotePath, err := remote.CleanRemotePath(inputPath)
	if err != nil || remotePath == "/" {
		return errors.New("a non-root absolute file path is required")
	}
	connection, err := h.connections.Get(ctx, ownerID, connectionID)
	if err != nil {
		return err
	}
	if connection.Kind == "ssh" {
		return errors.New("use an SFTP connection for SSH files")
	}
	if connection.Kind == "telnet" {
		return remote.ErrUnsupported
	}
	if connection.Kind == "vnc" && !connection.VNCFileTransfer {
		return errors.New("file transfer is disabled for this VNC connection")
	}
	var client remote.FileClient
	if connection.Kind == "vnc" {
		var starting bool
		client, starting = h.sessions.FileClientForConnection(ownerID, connectionID)
		if client == nil && starting {
			return errors.New("VNC desktop is still connecting")
		}
	}
	if client == nil {
		secret, err := h.connections.Credentials(ctx, connection)
		if err != nil {
			return err
		}
		client, err = h.dial(ctx, connection, secret)
		if err != nil {
			return err
		}
	}
	defer client.Close()
	source, err := client.Download(remotePath)
	if err != nil {
		return err
	}
	defer source.Close()
	_, err = io.Copy(destination, source)
	return err
}

// Upload streams the request body directly to a remote file.
func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	source, err := prepareUpload(w, r, h.maxUpload)
	if err != nil {
		writeUploadError(w, err)
		return
	}
	onProgress, release, ok := h.trackUpload(w, r)
	if !ok {
		return
	}
	defer release()
	client, remotePath, ok := h.open(w, r, "path")
	if !ok {
		return
	}
	defer client.Close()
	if remotePath == "/" {
		writeError(w, 400, "invalid_path", "a file path is required")
		return
	}
	if err := client.Upload(remotePath, source, onProgress); err != nil {
		writeUploadError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var errUploadSize = errors.New("upload body does not match the declared file size")

// prepareUpload checks for a lost body before any remote file can be truncated.
// The explicit size survives desktop transports that lose Content-Length.
func prepareUpload(w http.ResponseWriter, r *http.Request, limit int64) (io.Reader, error) {
	expected := int64(-1)
	if values, present := r.Header["X-Upload-Size"]; present {
		if len(values) != 1 || values[0] == "" || strings.Trim(values[0], "0123456789") != "" {
			return nil, errUploadSize
		}
		var err error
		expected, err = strconv.ParseInt(values[0], 10, 64)
		if err != nil {
			return nil, errUploadSize
		}
	} else if r.ContentLength > 0 {
		expected = r.ContentLength
	}
	if expected > limit || r.ContentLength > limit {
		return nil, &http.MaxBytesError{Limit: limit}
	}
	if expected >= 0 && r.ContentLength > 0 && expected != r.ContentLength {
		return nil, errUploadSize
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	reader := bufio.NewReader(r.Body)
	if expected >= 0 {
		_, err := reader.Peek(1)
		if (expected > 0 && err == io.EOF) || (expected == 0 && err == nil) {
			return nil, errUploadSize
		}
		if err != nil && err != io.EOF {
			return nil, err
		}
	}
	return &uploadSizeReader{source: reader, expected: expected}, nil
}

type uploadSizeReader struct {
	source   io.Reader
	expected int64
	read     int64
}

func (r *uploadSizeReader) Read(p []byte) (int, error) {
	n, err := r.source.Read(p)
	r.read += int64(n)
	if r.expected >= 0 && (r.read > r.expected || ((err == io.EOF || err == io.ErrUnexpectedEOF) && r.read != r.expected)) {
		return n, errUploadSize
	}
	return n, err
}

func writeUploadError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	switch {
	case errors.As(err, &maxBytes):
		writeError(w, 413, "too_large", "upload exceeds configured limit")
	case errors.Is(err, errUploadSize):
		writeError(w, 400, "upload_size_mismatch", errUploadSize.Error())
	default:
		writeRemoteError(w, err, "could not upload remote file")
	}
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
	if connection.Kind == "telnet" {
		writeError(w, 400, "invalid_connection", "remote server does not support this file operation")
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
	secret, err := h.connections.Credentials(r.Context(), connection)
	if err != nil {
		writeError(w, 500, "internal", "could not decrypt credentials")
		return nil, false
	}
	client, err := h.dial(r.Context(), connection, secret)
	if err != nil {
		writeRemoteError(w, err, err.Error())
		return nil, false
	}
	return client, true
}

// dial creates a file-only VNC bridge or a standalone SFTP/FTP client.
func (h *FileHandler) dial(ctx context.Context, connection model.Connection, secret model.RemoteSecret) (remote.FileClient, error) {
	if connection.Kind == "vnc" {
		bridge, err := remote.NewVNCBridge(ctx, connection, secret, h.dialTimeout)
		if err != nil {
			return nil, err
		}
		if err := bridge.StartHeadless(); err != nil {
			bridge.Close()
			return nil, err
		}
		return bridge.Files(true), nil
	}
	return remote.OpenFileClient(ctx, connection, secret, h.dialTimeout)
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
