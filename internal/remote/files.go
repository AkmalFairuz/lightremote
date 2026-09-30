package remote

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/jlaffaye/ftp"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

var ErrUnsupported = errors.New("operation is not supported by the remote server")

type FileClient interface {
	List(path string) ([]model.FileEntry, error)
	Download(path string) (io.ReadCloser, error)
	Upload(path string, source io.Reader, onProgress func(int64)) error
	Mkdir(path string) error
	Rename(oldPath, newPath string) error
	Delete(path string) error
	Close() error
}

// CleanRemotePath accepts POSIX and Windows drive-absolute remote paths.
func CleanRemotePath(value string) (string, error) {
	if strings.ContainsAny(value, "\x00\r\n") {
		return "", errors.New("invalid remote path")
	}
	if value == "" {
		return "/", nil
	}
	if len(value) >= 2 && isDriveLetter(value[0]) && value[1] == ':' {
		if len(value) > 2 && value[2] != '/' {
			return "", errors.New("remote drive path must start with a drive and slash")
		}
		tail := "/"
		if len(value) > 2 {
			tail = value[2:]
		}
		return strings.ToUpper(value[:1]) + ":" + path.Clean(tail), nil
	}
	if !strings.HasPrefix(value, "/") {
		return "", errors.New("remote path must be absolute")
	}
	return path.Clean(value), nil
}

func isDriveLetter(letter byte) bool {
	return letter >= 'A' && letter <= 'Z' || letter >= 'a' && letter <= 'z'
}

// OpenFileClient creates a short-lived SFTP or FTP client for one file request.
func OpenFileClient(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (FileClient, error) {
	switch connection.Kind {
	case "sftp":
		sshClient, err := DialSSH(ctx, connection, secret, timeout)
		if err != nil {
			return nil, err
		}
		client, err := sftp.NewClient(sshClient)
		if err != nil {
			sshClient.Close()
			return nil, err
		}
		return &sftpFiles{client: client, sshClient: sshClient}, nil
	case "ftp":
		return openFTPClient(ctx, connection, secret, timeout, DialConnection)
	default:
		return nil, ErrUnsupported
	}
}

// openFTPClient allows protocol tests to replace only the outbound TCP dial.
func openFTPClient(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration, dialRemote func(context.Context, model.Connection, model.RemoteSecret, string, time.Duration) (net.Conn, error)) (FileClient, error) {
	control, err := dialRemote(ctx, connection, secret, Address(connection), timeout)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: connection.Host,
	}
	var dialMu sync.Mutex
	controlAvailable := true
	dialData := func(_ string, address string) (net.Conn, error) {
		dialMu.Lock()
		if controlAvailable {
			controlAvailable = false
			dialMu.Unlock()
			return control, nil
		}
		dialMu.Unlock()
		target, err := ftpDataTarget(connection, address)
		if err != nil {
			return nil, err
		}
		data, err := dialRemote(ctx, connection, secret, target, timeout)
		if err != nil {
			return nil, err
		}
		if connection.FTPTLS {
			return tls.Client(data, tlsConfig), nil
		}
		return data, nil
	}
	options := []ftp.DialOption{
		ftp.DialWithContext(ctx),
		ftp.DialWithTimeout(timeout),
		ftp.DialWithDialFunc(dialData),
	}
	if connection.FTPTLS {
		options = append(options, ftp.DialWithExplicitTLS(tlsConfig))
	}
	client, err := ftp.Dial(Address(connection), options...)
	if err != nil {
		control.Close()
		return nil, err
	}
	if err := client.Login(connection.Username, secret.Password); err != nil {
		client.Quit()
		return nil, err
	}
	return &ftpFiles{client: client}, nil
}

// ftpDataTarget keeps proxied passive data sockets on the saved FTP server.
func ftpDataTarget(connection model.Connection, passiveAddress string) (string, error) {
	if connection.ProxyType == nil {
		return passiveAddress, nil
	}
	_, port, err := net.SplitHostPort(passiveAddress)
	if err != nil {
		return "", err
	}
	return net.JoinHostPort(connection.Host, port), nil
}

type sftpFiles struct {
	client    *sftp.Client
	sshClient *ssh.Client
}

// Home returns the initial working directory reported by the SFTP server.
func (f *sftpFiles) Home() (string, error) {
	return f.client.Getwd()
}

// List reads directory entries through the SFTP subsystem.
func (f *sftpFiles) List(remotePath string) ([]model.FileEntry, error) {
	files, err := f.client.ReadDir(remotePath)
	if err != nil {
		return nil, err
	}
	entries := make([]model.FileEntry, 0, len(files))
	for _, file := range files {
		entries = append(entries, model.FileEntry{
			Name:    file.Name(),
			Path:    path.Join(remotePath, file.Name()),
			Size:    file.Size(),
			IsDir:   file.IsDir(),
			ModTime: file.ModTime(),
		})
	}
	return entries, nil
}

// Download opens a remote SFTP file for streaming.
func (f *sftpFiles) Download(remotePath string) (io.ReadCloser, error) {
	return f.client.Open(remotePath)
}

// Upload truncates and streams a remote SFTP file.
func (f *sftpFiles) Upload(remotePath string, source io.Reader, onProgress func(int64)) error {
	target, err := f.client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(&uploadProgressWriter{target: target, onProgress: onProgress}, source)
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// Mkdir creates a remote SFTP directory.
func (f *sftpFiles) Mkdir(remotePath string) error {
	return f.client.Mkdir(remotePath)
}

// Rename moves a remote SFTP entry.
func (f *sftpFiles) Rename(oldPath, newPath string) error {
	return f.client.Rename(oldPath, newPath)
}

// Delete removes a remote SFTP file or empty directory.
func (f *sftpFiles) Delete(remotePath string) error {
	info, err := f.client.Stat(remotePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return f.client.RemoveDirectory(remotePath)
	}
	return f.client.Remove(remotePath)
}

// Close releases the SFTP subsystem and its SSH transport.
func (f *sftpFiles) Close() error {
	err := f.client.Close()
	sshErr := f.sshClient.Close()
	if err != nil {
		return err
	}
	return sshErr
}

type ftpFiles struct {
	client *ftp.ServerConn
}

// Home returns the FTP server's current directory after login.
func (f *ftpFiles) Home() (string, error) {
	return f.client.CurrentDir()
}

// List reads entries from an FTP directory.
func (f *ftpFiles) List(remotePath string) ([]model.FileEntry, error) {
	files, err := f.client.List(remotePath)
	if err != nil {
		return nil, err
	}
	entries := make([]model.FileEntry, 0, len(files))
	for _, file := range files {
		entries = append(entries, model.FileEntry{
			Name:    file.Name,
			Path:    path.Join(remotePath, file.Name),
			Size:    int64(file.Size),
			IsDir:   file.Type == ftp.EntryTypeFolder,
			ModTime: file.Time,
		})
	}
	return entries, nil
}

// Download opens an FTP data connection for one file.
func (f *ftpFiles) Download(remotePath string) (io.ReadCloser, error) {
	return f.client.Retr(remotePath)
}

// Upload streams one file over the FTP data connection.
func (f *ftpFiles) Upload(remotePath string, source io.Reader, onProgress func(int64)) error {
	return f.client.Stor(remotePath, &uploadProgressReader{source: source, onProgress: onProgress})
}

// Mkdir creates a remote FTP directory.
func (f *ftpFiles) Mkdir(remotePath string) error {
	return f.client.MakeDir(remotePath)
}

// Rename moves a remote FTP entry.
func (f *ftpFiles) Rename(oldPath, newPath string) error {
	return f.client.Rename(oldPath, newPath)
}

// Delete removes a remote FTP file or empty directory.
func (f *ftpFiles) Delete(remotePath string) error {
	if err := f.client.Delete(remotePath); err == nil {
		return nil
	}
	return f.client.RemoveDir(remotePath)
}

// Close ends the FTP control connection.
func (f *ftpFiles) Close() error {
	return f.client.Quit()
}
