package remote

import (
	"io"
	"sync"

	"github.com/akmalfairuz/lightremote/internal/model"
)

// vncFileProtocol contains the file operations shared by both RFB extensions.
// The outer client alone owns the bridge lifecycle.
type vncFileProtocol interface {
	List(path string) ([]model.FileEntry, error)
	Download(path string) (io.ReadCloser, error)
	Upload(path string, source io.Reader, onProgress func(int64)) error
	Mkdir(path string) error
	Rename(oldPath, newPath string) error
	Delete(path string) error
}

// vncFileClient chooses one wire protocol, then keeps that choice for this client.
type vncFileClient struct {
	bridge   *VNCBridge
	owned    bool
	mu       sync.Mutex
	protocol vncFileProtocol
}

func (b *VNCBridge) Files(owned bool) FileClient {
	return &vncFileClient{bridge: b, owned: owned}
}

func (f *vncFileClient) selected() (vncFileProtocol, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.protocol != nil {
		return f.protocol, nil
	}

	// TightVNC advertises explicit message capabilities in its handshake.
	if f.bridge.supportsTightFiles() {
		f.protocol = &tightVNCFiles{bridge: f.bridge}
		return f.protocol, nil
	}
	// UltraVNC uses RFB message 7 and a separate version/permission exchange.
	if err := f.bridge.enableUltraFiles(); err != nil {
		return nil, err
	}
	f.protocol = &ultraVNCFiles{bridge: f.bridge}
	return f.protocol, nil
}

func (f *vncFileClient) List(remotePath string) ([]model.FileEntry, error) {
	client, err := f.selected()
	if err != nil {
		return nil, err
	}
	return client.List(remotePath)
}

func (f *vncFileClient) Download(remotePath string) (io.ReadCloser, error) {
	client, err := f.selected()
	if err != nil {
		return nil, err
	}
	return client.Download(remotePath)
}

func (f *vncFileClient) Upload(remotePath string, source io.Reader, onProgress func(int64)) error {
	client, err := f.selected()
	if err != nil {
		return err
	}
	return client.Upload(remotePath, source, onProgress)
}

func (f *vncFileClient) Mkdir(remotePath string) error {
	client, err := f.selected()
	if err != nil {
		return err
	}
	return client.Mkdir(remotePath)
}

func (f *vncFileClient) Rename(oldPath, newPath string) error {
	client, err := f.selected()
	if err != nil {
		return err
	}
	return client.Rename(oldPath, newPath)
}

func (f *vncFileClient) Delete(remotePath string) error {
	client, err := f.selected()
	if err != nil {
		return err
	}
	return client.Delete(remotePath)
}

func (f *vncFileClient) Close() error {
	if f.owned {
		return f.bridge.Close()
	}
	return nil
}
