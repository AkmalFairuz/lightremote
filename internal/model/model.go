package model

import "time"

type User struct {
	ID           string    `db:"id" json:"id"`
	Email        string    `db:"email" json:"email"`
	PasswordHash string    `db:"password_hash" json:"-"`
	Role         string    `db:"role" json:"role"`
	Disabled     bool      `db:"disabled" json:"disabled"`
	CreatedAt    time.Time `db:"created_at" json:"createdAt"`
}

type Folder struct {
	ID        string    `db:"id" json:"id"`
	UserID    string    `db:"user_id" json:"-"`
	ParentID  *string   `db:"parent_id" json:"parentId"`
	Name      string    `db:"name" json:"name"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

type Connection struct {
	ID              string    `db:"id" json:"id"`
	Direct          bool      `db:"-" json:"direct"`
	UserID          string    `db:"user_id" json:"-"`
	FolderID        *string   `db:"folder_id" json:"folderId"`
	Name            string    `db:"name" json:"name"`
	Kind            string    `db:"kind" json:"kind"`
	Host            string    `db:"host" json:"host"`
	Port            int       `db:"port" json:"port"`
	Username        string    `db:"username" json:"username"`
	AuthType        string    `db:"auth_type" json:"authType"`
	SSHKeyID        *string   `db:"ssh_key_id" json:"sshKeyId"`
	FTPTLS          bool      `db:"ftp_tls" json:"ftpTls"`
	VNCEncoding     string    `db:"vnc_encoding" json:"vncEncoding"`
	VNCReadOnly     bool      `db:"vnc_read_only" json:"vncReadOnly"`
	VNCFileTransfer bool      `db:"vnc_file_transfer" json:"vncFileTransfer"`
	Secret          []byte    `db:"secret" json:"-"`
	ProxyType       *string   `db:"proxy_type" json:"-"`
	ProxyHost       *string   `db:"proxy_host" json:"-"`
	ProxyPort       *int      `db:"proxy_port" json:"-"`
	ProxyUser       *string   `db:"proxy_username" json:"-"`
	ProxySecret     []byte    `db:"proxy_secret" json:"-"`
	Proxy           *Proxy    `db:"-" json:"proxy"`
	HostKey         *string   `db:"host_key" json:"hostKeyFingerprint"`
	LastOpenedAt    *int64    `db:"last_opened_at" json:"-"`
	CreatedAt       time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt       time.Time `db:"updated_at" json:"updatedAt"`
}

type RemoteSecret struct {
	Password      string `json:"password,omitempty"`
	PrivateKey    string `json:"privateKey,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
	ProxyPassword string `json:"-"`
}

type ConnectionInput struct {
	FolderID        *string       `json:"folderId"`
	Name            string        `json:"name"`
	Kind            string        `json:"kind"`
	Host            string        `json:"host"`
	Port            int           `json:"port"`
	Username        string        `json:"username"`
	AuthType        string        `json:"authType"`
	SSHKeyID        *string       `json:"sshKeyId"`
	FTPTLS          *bool         `json:"ftpTls"`
	VNCEncoding     string        `json:"vncEncoding"`
	VNCReadOnly     bool          `json:"vncReadOnly"`
	VNCFileTransfer *bool         `json:"vncFileTransfer"`
	Secret          *RemoteSecret `json:"secret"`
	Proxy           *ProxyInput   `json:"proxy"`
}

type ProxyInput struct {
	Type     string  `json:"type"`
	Host     string  `json:"host"`
	Port     int     `json:"port"`
	Username string  `json:"username"`
	Password *string `json:"password"`
}

type Proxy struct {
	Type        string `json:"type"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	HasPassword bool   `json:"hasPassword"`
}

// PublicProxy returns non-secret proxy settings for a saved connection.
func (c Connection) PublicProxy() *Proxy {
	if c.ProxyType == nil || c.ProxyHost == nil || c.ProxyPort == nil {
		return nil
	}
	username := ""
	if c.ProxyUser != nil {
		username = *c.ProxyUser
	}
	return &Proxy{
		Type:        *c.ProxyType,
		Host:        *c.ProxyHost,
		Port:        *c.ProxyPort,
		Username:    username,
		HasPassword: len(c.ProxySecret) > 0,
	}
}

type FileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
}
