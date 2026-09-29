package connections

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
)

// TestProxyPasswordUpdate keeps credentials only for the same proxy identity.
func TestProxyPasswordUpdate(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	vault, err := security.NewVault(key)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{vault: vault}
	connection := model.Connection{ID: "connection-a"}
	password := "proxy-password"
	proxy := &model.ProxyInput{Type: "socks5", Host: "proxy.example", Port: 1080, Username: "alice", Password: &password}
	if err := service.applyProxy(&connection, proxy, false); err != nil {
		t.Fatal(err)
	}
	stored := append([]byte(nil), connection.ProxySecret...)
	proxy.Password = nil
	if err := service.applyProxy(&connection, proxy, true); err != nil {
		t.Fatalf("same proxy did not retain password: %v", err)
	}
	if string(stored) != string(connection.ProxySecret) {
		t.Fatal("same proxy lost its encrypted password")
	}
	changed := *proxy
	changed.Host = "other.example"
	if err := service.applyProxy(&connection, &changed, true); err == nil {
		t.Fatal("changed authenticated proxy retained old password")
	}
	if string(stored) != string(connection.ProxySecret) {
		t.Fatal("failed proxy update modified saved password")
	}
	encoded, err := json.Marshal(connection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), password) || strings.Contains(string(encoded), "proxy_secret") {
		t.Fatal("proxy password appeared in connection JSON")
	}
}
