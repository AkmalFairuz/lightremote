package connections

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/akmalfairuz/lightremote/internal/folders"
	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/google/uuid"
)

var ErrInvalid = errors.New("invalid connection")

const (
	maxConnectionFieldBytes = 255
	maxConnectionPort       = 65535
)

type Service struct {
	repository *store.ConnectionRepository
	folders    *folders.Service
	vault      *security.Vault
	cache      *metadataCache
	directMu   sync.Mutex
	direct     map[string]directEntry
}

const directIdleTTL = 24 * time.Hour

type directEntry struct {
	connection model.Connection
	lastUsed   time.Time
	timer      *time.Timer
}

// NewService creates saved and temporary connection operations with encrypted credentials.
func NewService(repository *store.ConnectionRepository, folders *folders.Service, vault *security.Vault) *Service {
	return &Service{
		repository: repository,
		folders:    folders,
		vault:      vault,
		cache:      newMetadataCache(),
		direct:     make(map[string]directEntry),
	}
}

// List returns non-secret connection metadata owned by an account.
func (s *Service) List(ctx context.Context, ownerID string) ([]model.Connection, error) {
	connections, err := s.repository.List(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	for index := range connections {
		s.cache.put(connections[index])
		connections[index].Secret = nil
		connections[index].ProxySecret = nil
	}
	return connections, nil
}

// Public returns one cached or stored connection without its credentials.
func (s *Service) Public(ctx context.Context, ownerID, id string) (model.Connection, error) {
	s.directMu.Lock()
	_, direct := s.direct[id]
	s.directMu.Unlock()
	if direct {
		connection, err := s.Get(ctx, ownerID, id)
		connection.Secret = nil
		connection.ProxySecret = nil
		return connection, err
	}
	if connection, ok := s.cache.get(id); ok && connection.UserID == ownerID {
		return connection, nil
	}
	connection, err := s.repository.Get(ctx, ownerID, id)
	if err != nil {
		return connection, err
	}
	s.cache.put(connection)
	connection.Secret = nil
	connection.ProxySecret = nil
	return connection, nil
}

// Get returns an owned connection including its encrypted credential envelope.
func (s *Service) Get(ctx context.Context, ownerID, id string) (model.Connection, error) {
	s.directMu.Lock()
	entry, ok := s.direct[id]
	if ok {
		if entry.connection.UserID != ownerID {
			s.directMu.Unlock()
			return model.Connection{}, sql.ErrNoRows
		}
		if time.Since(entry.lastUsed) > directIdleTTL {
			entry.timer.Stop()
			delete(s.direct, id)
			s.directMu.Unlock()
			return model.Connection{}, sql.ErrNoRows
		}
		entry.lastUsed = time.Now()
		s.direct[id] = entry
		s.directMu.Unlock()
		return entry.connection, nil
	}
	s.directMu.Unlock()
	return s.repository.Get(ctx, ownerID, id)
}

// CreateDirect keeps encrypted credentials in memory without adding a saved connection.
func (s *Service) CreateDirect(ownerID string, input model.ConnectionInput) (model.Connection, error) {
	input.FolderID = nil
	input.Name = input.Host
	if err := validate(input); err != nil {
		return model.Connection{}, err
	}
	if err := validateSecret(input); err != nil {
		return model.Connection{}, err
	}
	now := time.Now().UTC()
	connection := model.Connection{
		ID:              uuid.NewString(),
		Direct:          true,
		UserID:          ownerID,
		Name:            input.Name,
		Kind:            input.Kind,
		Host:            input.Host,
		Port:            input.Port,
		Username:        input.Username,
		AuthType:        input.AuthType,
		FTPTLS:          input.FTPTLS != nil && *input.FTPTLS,
		VNCEncoding:     vncEncoding(input),
		VNCReadOnly:     input.VNCReadOnly,
		VNCFileTransfer: vncFileTransfer(input, true),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if input.Secret != nil {
		secret, err := s.vault.SealCredentials(connection.ID, *input.Secret)
		if err != nil {
			return model.Connection{}, err
		}
		connection.Secret = secret
	}
	if err := s.applyProxy(&connection, input.Proxy, false); err != nil {
		return model.Connection{}, err
	}
	directID := connection.ID
	s.directMu.Lock()
	s.direct[directID] = directEntry{
		connection: connection,
		lastUsed:   now,
		timer: time.AfterFunc(directIdleTTL, func() {
			s.expireDirect(directID)
		}),
	}
	s.directMu.Unlock()
	connection.Secret = nil
	connection.ProxySecret = nil
	return connection, nil
}

// DeleteDirect removes only a temporary connection owned by the caller.
func (s *Service) DeleteDirect(ownerID, id string) bool {
	s.directMu.Lock()
	defer s.directMu.Unlock()
	entry, ok := s.direct[id]
	if !ok || entry.connection.UserID != ownerID {
		return false
	}
	entry.timer.Stop()
	delete(s.direct, id)
	return true
}

// DeleteDirectOwner discards all of an account's temporary connections.
func (s *Service) DeleteDirectOwner(ownerID string) {
	s.directMu.Lock()
	defer s.directMu.Unlock()
	for id, entry := range s.direct {
		if entry.connection.UserID != ownerID {
			continue
		}
		entry.timer.Stop()
		delete(s.direct, id)
	}
}

// expireDirect reschedules an entry that was used since its last timer began.
func (s *Service) expireDirect(id string) {
	s.directMu.Lock()
	defer s.directMu.Unlock()
	entry, ok := s.direct[id]
	if !ok {
		return
	}
	remaining := directIdleTTL - time.Since(entry.lastUsed)
	if remaining <= 0 {
		delete(s.direct, id)
		return
	}
	entry.timer = time.AfterFunc(remaining, func() {
		s.expireDirect(id)
	})
	s.direct[id] = entry
}

// Create validates and stores an owned remote connection.
func (s *Service) Create(ctx context.Context, ownerID string, input model.ConnectionInput) (model.Connection, error) {
	if err := validate(input); err != nil {
		return model.Connection{}, err
	}
	if err := validateSecret(input); err != nil {
		return model.Connection{}, err
	}
	if err := s.folders.ValidateOwner(ctx, ownerID, input.FolderID); err != nil {
		return model.Connection{}, err
	}
	now := time.Now().UTC()
	connection := model.Connection{
		ID:              uuid.NewString(),
		UserID:          ownerID,
		FolderID:        input.FolderID,
		Name:            input.Name,
		Kind:            input.Kind,
		Host:            input.Host,
		Port:            input.Port,
		Username:        input.Username,
		AuthType:        input.AuthType,
		FTPTLS:          input.FTPTLS != nil && *input.FTPTLS,
		VNCEncoding:     vncEncoding(input),
		VNCReadOnly:     input.VNCReadOnly,
		VNCFileTransfer: vncFileTransfer(input, true),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if input.Secret != nil {
		encrypted, err := s.vault.SealCredentials(connection.ID, *input.Secret)
		if err != nil {
			return model.Connection{}, err
		}
		connection.Secret = encrypted
	}
	if err := s.applyProxy(&connection, input.Proxy, false); err != nil {
		return model.Connection{}, err
	}
	if err := s.repository.Create(ctx, connection); err != nil {
		return model.Connection{}, err
	}
	s.cache.put(connection)
	connection.Secret = nil
	connection.ProxySecret = nil
	return connection, nil
}

// Duplicate copies an owned connection and re-encrypts its secrets for the new ID.
func (s *Service) Duplicate(ctx context.Context, ownerID, id string) (model.Connection, error) {
	source, err := s.repository.Get(ctx, ownerID, id)
	if err != nil {
		return model.Connection{}, err
	}

	copy := source
	copy.ID = uuid.NewString()
	copy.Name = duplicateName(source.Name)
	copy.CreatedAt = time.Now().UTC()
	copy.UpdatedAt = copy.CreatedAt
	if len(source.Secret) > 0 {
		secret, err := s.vault.OpenCredentials(source)
		if err != nil {
			return model.Connection{}, err
		}
		copy.Secret, err = s.vault.SealCredentials(copy.ID, secret)
		if err != nil {
			return model.Connection{}, err
		}
	}
	if len(source.ProxySecret) > 0 {
		password, err := s.vault.OpenProxyPassword(source)
		if err != nil {
			return model.Connection{}, err
		}
		copy.ProxySecret, err = s.vault.SealProxyPassword(copy.ID, password)
		if err != nil {
			return model.Connection{}, err
		}
	}
	if err := s.repository.Create(ctx, copy); err != nil {
		return model.Connection{}, err
	}
	s.cache.put(copy)
	copy.Proxy = copy.PublicProxy()
	copy.Secret = nil
	copy.ProxySecret = nil
	return copy, nil
}

func duplicateName(name string) string {
	const suffix = " copy"
	for len(name)+len(suffix) > maxConnectionFieldBytes {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	return name + suffix
}

// Update replaces settings while retaining the secret when none is supplied.
func (s *Service) Update(ctx context.Context, ownerID, id string, input model.ConnectionInput) (model.Connection, error) {
	connection, err := s.repository.Get(ctx, ownerID, id)
	if err != nil {
		return connection, err
	}
	if err := validate(input); err != nil {
		return model.Connection{}, err
	}
	if input.Secret == nil && (connection.AuthType != input.AuthType || connection.Kind != input.Kind) {
		return model.Connection{}, ErrInvalid
	}
	if input.Secret != nil {
		if err := validateSecret(input); err != nil {
			return model.Connection{}, err
		}
	}
	if err := s.folders.ValidateOwner(ctx, ownerID, input.FolderID); err != nil {
		return model.Connection{}, err
	}
	if connection.Host != input.Host || connection.Port != input.Port {
		connection.HostKey = nil
	}
	connection.FolderID = input.FolderID
	connection.Name = input.Name
	connection.Kind = input.Kind
	connection.Host = input.Host
	connection.Port = input.Port
	connection.Username = input.Username
	connection.AuthType = input.AuthType
	connection.FTPTLS = input.FTPTLS != nil && *input.FTPTLS
	connection.VNCEncoding = vncEncoding(input)
	connection.VNCReadOnly = input.VNCReadOnly
	connection.VNCFileTransfer = vncFileTransfer(input, connection.VNCFileTransfer)
	connection.UpdatedAt = time.Now().UTC()
	if input.Secret != nil {
		connection.Secret, err = s.vault.SealCredentials(id, *input.Secret)
		if err != nil {
			return model.Connection{}, err
		}
	}
	if err := s.applyProxy(&connection, input.Proxy, true); err != nil {
		return model.Connection{}, err
	}
	if err := s.repository.Update(ctx, connection); err != nil {
		return model.Connection{}, err
	}
	s.cache.delete(id)
	connection.Secret = nil
	connection.ProxySecret = nil
	return connection, nil
}

// MoveToFolder changes a saved connection's location without closing work sessions.
func (s *Service) MoveToFolder(ctx context.Context, ownerID, id string, folderID *string) (model.Connection, error) {
	if err := s.folders.ValidateOwner(ctx, ownerID, folderID); err != nil {
		return model.Connection{}, err
	}
	if err := s.repository.MoveToFolder(ctx, ownerID, id, folderID, time.Now().UTC()); err != nil {
		return model.Connection{}, err
	}
	s.cache.delete(id)
	return s.Public(ctx, ownerID, id)
}

// Rename changes a connection's label without restarting its work sessions.
func (s *Service) Rename(ctx context.Context, ownerID, id, name string) (model.Connection, error) {
	if !validConnectionName(name) {
		return model.Connection{}, ErrInvalid
	}
	if err := s.repository.Rename(ctx, ownerID, id, name, time.Now().UTC()); err != nil {
		return model.Connection{}, err
	}
	s.cache.delete(id)
	return s.Public(ctx, ownerID, id)
}

// Delete removes a connection owned by the account.
func (s *Service) Delete(ctx context.Context, ownerID, id string) (bool, error) {
	deleted, err := s.repository.Delete(ctx, ownerID, id)
	if deleted {
		s.cache.delete(id)
	}
	return deleted, err
}

// ApproveHostKey pins the fingerprint confirmed for an SSH or SFTP server.
func (s *Service) ApproveHostKey(ctx context.Context, ownerID, id, fingerprint string) error {
	s.directMu.Lock()
	entry, ok := s.direct[id]
	if ok {
		if entry.connection.UserID != ownerID || time.Since(entry.lastUsed) > directIdleTTL {
			s.directMu.Unlock()
			return sql.ErrNoRows
		}
		entry.connection.HostKey = &fingerprint
		entry.lastUsed = time.Now()
		s.direct[id] = entry
		s.directMu.Unlock()
		return nil
	}
	s.directMu.Unlock()
	if err := s.repository.SetHostKey(ctx, ownerID, id, fingerprint); err != nil {
		return err
	}
	s.cache.delete(id)
	return nil
}

// Credentials opens the encrypted remote secret for an authorized connection.
func (s *Service) Credentials(connection model.Connection) (model.RemoteSecret, error) {
	secret, err := s.vault.OpenCredentials(connection)
	if err != nil {
		return secret, err
	}
	secret.ProxyPassword, err = s.vault.OpenProxyPassword(connection)
	return secret, err
}

// applyProxy validates and encrypts the optional proxy for one connection.
func (s *Service) applyProxy(connection *model.Connection, input *model.ProxyInput, updating bool) error {
	if input == nil {
		connection.ProxyType = nil
		connection.ProxyHost = nil
		connection.ProxyPort = nil
		connection.ProxyUser = nil
		connection.ProxySecret = nil
		connection.Proxy = nil
		return nil
	}
	if input.Type != "http" && input.Type != "https" && input.Type != "socks5" {
		return ErrInvalid
	}
	if !validHost(input.Host) || input.Port < 1 || input.Port > maxConnectionPort ||
		len(input.Username) > maxConnectionFieldBytes || strings.ContainsAny(input.Username, ":\x00\r\n") {
		return ErrInvalid
	}
	if input.Username == "" && input.Password != nil && *input.Password != "" {
		return ErrInvalid
	}
	// An omitted password may only retain the old secret for the same proxy endpoint.
	sameIdentity := updating && connection.ProxyType != nil && connection.ProxyHost != nil &&
		connection.ProxyPort != nil && connection.ProxyUser != nil &&
		*connection.ProxyType == input.Type && *connection.ProxyHost == input.Host &&
		*connection.ProxyPort == input.Port && *connection.ProxyUser == input.Username
	if input.Username != "" && input.Password == nil && (!sameIdentity || len(connection.ProxySecret) == 0) {
		return ErrInvalid
	}
	if input.Password != nil {
		if input.Username != "" && (*input.Password == "" || len(*input.Password) > maxConnectionFieldBytes) {
			return ErrInvalid
		}
		connection.ProxySecret = nil
		if *input.Password != "" {
			secret, err := s.vault.SealProxyPassword(connection.ID, *input.Password)
			if err != nil {
				return err
			}
			connection.ProxySecret = secret
		}
	} else if !sameIdentity {
		connection.ProxySecret = nil
	}
	connection.ProxyType = &input.Type
	connection.ProxyHost = &input.Host
	connection.ProxyPort = &input.Port
	connection.ProxyUser = &input.Username
	connection.Proxy = connection.PublicProxy()
	return nil
}

// Address formats a connection's host and port for network dialing.
func Address(connection model.Connection) string {
	return net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port))
}

// validate checks protocol-specific settings before they reach a repository.
func validate(input model.ConnectionInput) error {
	switch input.Kind {
	case "ssh", "sftp", "ftp", "vnc":
	default:
		return ErrInvalid
	}
	if !validConnectionName(input.Name) {
		return ErrInvalid
	}
	if strings.ContainsAny(input.Username, "\x00\r\n") {
		return ErrInvalid
	}
	if !validHost(input.Host) {
		return ErrInvalid
	}
	if input.Port < 1 || input.Port > maxConnectionPort {
		return ErrInvalid
	}
	switch input.Kind {
	case "ssh", "sftp":
		if input.Username == "" || (input.AuthType != "password" && input.AuthType != "private_key") {
			return ErrInvalid
		}
	case "ftp":
		if input.Username == "" || input.AuthType != "password" || input.FTPTLS == nil {
			return ErrInvalid
		}
	case "vnc":
		if input.AuthType != "password" && input.AuthType != "none" {
			return ErrInvalid
		}
	}
	if input.Kind != "ftp" && input.FTPTLS != nil && *input.FTPTLS {
		return ErrInvalid
	}
	if input.Kind == "vnc" {
		switch input.VNCEncoding {
		case "", "auto", "copyrect", "tight", "zlib", "hextile", "zrle", "raw":
		default:
			return ErrInvalid
		}
		if input.VNCFileTransfer != nil && !*input.VNCFileTransfer && !input.VNCReadOnly {
			return ErrInvalid
		}
	} else if input.VNCEncoding != "" || input.VNCReadOnly || input.VNCFileTransfer != nil {
		return ErrInvalid
	}
	return nil
}

func vncEncoding(input model.ConnectionInput) string {
	if input.Kind != "vnc" {
		return "auto"
	}
	if input.VNCEncoding == "" {
		return "auto"
	}
	return input.VNCEncoding
}

func vncFileTransfer(input model.ConnectionInput, current bool) bool {
	if input.VNCFileTransfer != nil {
		return *input.VNCFileTransfer
	}
	if input.Kind == "vnc" && input.VNCReadOnly {
		return current
	}
	return true
}

// validConnectionName rejects empty or control-bearing connection labels.
func validConnectionName(name string) bool {
	return strings.TrimSpace(name) != "" && len(name) <= maxConnectionFieldBytes && !strings.ContainsAny(name, "\x00\r\n")
}

// validHost prevents control characters and delimiters in network hostnames.
func validHost(host string) bool {
	return host != "" && len(host) <= maxConnectionFieldBytes &&
		!strings.ContainsAny(host, "\x00\r\n\t /\\@")
}

// validateSecret ensures the selected remote authentication has material to use.
func validateSecret(input model.ConnectionInput) error {
	if input.Kind == "vnc" && input.AuthType == "none" {
		return nil
	}
	if input.Secret == nil {
		return ErrInvalid
	}
	if input.AuthType == "private_key" {
		if input.Secret.PrivateKey == "" {
			return ErrInvalid
		}
		return nil
	}
	if input.Secret.Password == "" {
		return ErrInvalid
	}
	return nil
}
