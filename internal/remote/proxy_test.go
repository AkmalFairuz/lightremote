package remote

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
)

// TestHTTPProxyConnect checks proxy authentication, target DNS, and buffered tunnel bytes.
func TestHTTPProxyConnect(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	finished := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(server)
		line, err := reader.ReadString('\n')
		if err != nil || line != "CONNECT private.internal:5900 HTTP/1.1\r\n" {
			finished <- errors.New("wrong CONNECT target")
			return
		}
		foundAuth := false
		for {
			line, err = reader.ReadString('\n')
			if err != nil {
				finished <- err
				return
			}
			if strings.HasPrefix(line, "Proxy-Authorization: Basic ") {
				want := base64.StdEncoding.EncodeToString([]byte("alice:secret"))
				foundAuth = strings.TrimSpace(strings.TrimPrefix(line, "Proxy-Authorization: Basic ")) == want
			}
			if line == "\r\n" {
				break
			}
		}
		if !foundAuth {
			finished <- errors.New("missing proxy credentials")
			return
		}
		_, err = server.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\nready"))
		finished <- err
	}()

	proxyType, proxyHost, proxyUser, proxyPort := "http", "proxy.example", "alice", 3128
	connection := model.Connection{ProxyType: &proxyType, ProxyHost: &proxyHost, ProxyUser: &proxyUser, ProxyPort: &proxyPort}
	dial := func(_ context.Context, _, address string, _ time.Duration) (net.Conn, error) {
		if address != "proxy.example:3128" {
			return nil, errors.New("dialed target instead of proxy")
		}
		return client, nil
	}
	tunnel, err := dialConnection(context.Background(), connection, model.RemoteSecret{ProxyPassword: "secret"}, "private.internal:5900", time.Second, dial, nil)
	if err != nil {
		t.Fatalf("CONNECT: %v", err)
	}
	var payload [5]byte
	if _, err := io.ReadFull(tunnel, payload[:]); err != nil || string(payload[:]) != "ready" {
		t.Fatalf("tunnel payload: %q, %v", payload, err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

// TestHTTPProxyFailureDoesNotDialTarget keeps failed proxy sessions from falling back.
func TestHTTPProxyFailureDoesNotDialTarget(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	go func() {
		reader := bufio.NewReader(server)
		for {
			line, err := reader.ReadString('\n')
			if err != nil || line == "\r\n" {
				break
			}
		}
		_, _ = server.Write([]byte("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n"))
	}()
	proxyType, proxyHost, proxyUser, proxyPort := "http", "proxy.example", "", 3128
	connection := model.Connection{ProxyType: &proxyType, ProxyHost: &proxyHost, ProxyUser: &proxyUser, ProxyPort: &proxyPort}
	dials := 0
	dial := func(_ context.Context, _, address string, _ time.Duration) (net.Conn, error) {
		dials++
		if address != "proxy.example:3128" {
			return nil, errors.New("direct target dial")
		}
		return client, nil
	}
	if _, err := dialConnection(context.Background(), connection, model.RemoteSecret{}, "private.internal:22", time.Second, dial, nil); err == nil {
		t.Fatal("proxy rejection was accepted")
	}
	if dials != 1 {
		t.Fatalf("expected one proxy dial, got %d", dials)
	}
}

// TestSOCKS5ProxyConnect checks authenticated remote-name tunneling.
func TestSOCKS5ProxyConnect(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	finished := make(chan error, 1)
	go func() {
		var greeting [3]byte
		if _, err := io.ReadFull(server, greeting[:]); err != nil || greeting != [3]byte{5, 1, 2} {
			finished <- errors.New("wrong SOCKS5 greeting")
			return
		}
		if _, err := server.Write([]byte{5, 2}); err != nil {
			finished <- err
			return
		}
		var auth [14]byte
		if _, err := io.ReadFull(server, auth[:]); err != nil || string(auth[:]) != "\x01\x05alice\x06secret" {
			finished <- errors.New("wrong SOCKS5 authentication")
			return
		}
		if _, err := server.Write([]byte{1, 0}); err != nil {
			finished <- err
			return
		}
		var request [4]byte
		if _, err := io.ReadFull(server, request[:]); err != nil || request != [4]byte{5, 1, 0, 3} {
			finished <- errors.New("wrong SOCKS5 CONNECT request")
			return
		}
		var length [1]byte
		if _, err := io.ReadFull(server, length[:]); err != nil {
			finished <- err
			return
		}
		nameAndPort := make([]byte, int(length[0])+2)
		if _, err := io.ReadFull(server, nameAndPort); err != nil || string(nameAndPort) != "private.internal\x00\x16" {
			finished <- errors.New("target hostname was not sent to proxy")
			return
		}
		_, err := server.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
		finished <- err
	}()

	proxyType, proxyHost, proxyUser, proxyPort := "socks5", "proxy.example", "alice", 1080
	connection := model.Connection{ProxyType: &proxyType, ProxyHost: &proxyHost, ProxyUser: &proxyUser, ProxyPort: &proxyPort}
	dial := func(_ context.Context, _, address string, _ time.Duration) (net.Conn, error) {
		if address != "proxy.example:1080" {
			return nil, errors.New("dialed target instead of proxy")
		}
		return client, nil
	}
	if _, err := dialConnection(context.Background(), connection, model.RemoteSecret{ProxyPassword: "secret"}, "private.internal:22", time.Second, dial, nil); err != nil {
		t.Fatalf("SOCKS5 CONNECT: %v", err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

// TestHTTPSProxyConnect verifies TLS to the proxy before tunneling the target.
func TestHTTPSProxyConnect(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		DNSNames:     []string{"proxy.example"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, privateKey.Public(), privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(certificate)
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	finished := make(chan error, 1)
	go func() {
		secure := tls.Server(server, &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: privateKey}}})
		reader := bufio.NewReader(secure)
		line, err := reader.ReadString('\n')
		if err != nil || line != "CONNECT private.internal:22 HTTP/1.1\r\n" {
			finished <- errors.New("wrong HTTPS CONNECT target")
			return
		}
		for {
			line, err = reader.ReadString('\n')
			if err != nil {
				finished <- err
				return
			}
			if line == "\r\n" {
				break
			}
		}
		_, err = secure.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\nok"))
		finished <- err
	}()
	proxyType, proxyHost, proxyUser, proxyPort := "https", "proxy.example", "", 443
	connection := model.Connection{ProxyType: &proxyType, ProxyHost: &proxyHost, ProxyUser: &proxyUser, ProxyPort: &proxyPort}
	dial := func(_ context.Context, _, address string, _ time.Duration) (net.Conn, error) {
		if address != "proxy.example:443" {
			return nil, errors.New("dialed target instead of HTTPS proxy")
		}
		return client, nil
	}
	tunnel, err := dialConnection(context.Background(), connection, model.RemoteSecret{}, "private.internal:22", time.Second, dial, roots)
	if err != nil {
		t.Fatalf("HTTPS CONNECT: %v", err)
	}
	defer tunnel.Close()
	var data [2]byte
	if _, err := io.ReadFull(tunnel, data[:]); err != nil || string(data[:]) != "ok" {
		t.Fatalf("HTTPS tunnel payload: %q, %v", data, err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	server.Close()
}

type proxyTCPConn struct {
	net.Conn
}

// RemoteAddr supplies the TCP address expected by the FTP library.
func (c proxyTCPConn) RemoteAddr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(192, 0, 2, 1), Port: 3128}
}

// TestFTPControlAndDataThroughProxy checks separate CONNECT tunnels for passive FTP.
func TestFTPControlAndDataThroughProxy(t *testing.T) {
	proxyType, proxyHost, proxyUser, proxyPort := "http", "proxy.example", "", 3128
	connection := model.Connection{
		Kind: "ftp", Host: "private.ftp", Port: 21,
		Username: "alice", ProxyType: &proxyType, ProxyHost: &proxyHost,
		ProxyUser: &proxyUser, ProxyPort: &proxyPort,
	}
	requests := make(chan string, 2)
	fixtureErrors := make(chan error, 2)
	startData := make(chan struct{})
	dataDone := make(chan struct{})
	endpoint := func(_ context.Context, _, address string, _ time.Duration) (net.Conn, error) {
		if address != "proxy.example:3128" {
			return nil, errors.New("FTP bypassed proxy")
		}
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			fixtureErrors <- serveFTPProxyFixture(server, requests, startData, dataDone)
		}()
		return proxyTCPConn{Conn: client}, nil
	}
	dialRemote := func(ctx context.Context, c model.Connection, secret model.RemoteSecret, target string, timeout time.Duration) (net.Conn, error) {
		return dialConnection(ctx, c, secret, target, timeout, endpoint, nil)
	}
	client, err := openFTPClient(context.Background(), connection, model.RemoteSecret{Password: "remote-password"}, time.Second, dialRemote)
	if err != nil {
		t.Fatalf("FTP control through proxy: %v", err)
	}
	entries, err := client.List("/")
	if err != nil || len(entries) != 0 {
		t.Fatalf("FTP passive listing: %v, %+v", err, entries)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("FTP close: %v", err)
	}
	if control, data := <-requests, <-requests; control != "private.ftp:21" || data != "private.ftp:49152" {
		t.Fatalf("FTP CONNECT targets: %q, %q", control, data)
	}
	for range 2 {
		if err := <-fixtureErrors; err != nil {
			t.Fatal(err)
		}
	}
}

// serveFTPProxyFixture handles one HTTP tunnel and a minimal FTP control or data stream.
func serveFTPProxyFixture(socket net.Conn, requests chan<- string, startData, dataDone chan struct{}) error {
	reader := bufio.NewReader(socket)
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	parts := strings.Split(line, " ")
	if len(parts) < 3 || parts[0] != "CONNECT" {
		return errors.New("missing FTP CONNECT")
	}
	target := parts[1]
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			return err
		}
		if line == "\r\n" {
			break
		}
	}
	requests <- target
	if err := writeProxyRequest(socket, []byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return err
	}
	if target == "private.ftp:49152" {
		<-startData
		close(dataDone)
		return nil
	}
	if target != "private.ftp:21" {
		return errors.New("wrong FTP target")
	}
	if err := writeProxyRequest(socket, []byte("220 Ready\r\n")); err != nil {
		return err
	}
	for {
		command, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		response := "500 Unsupported\r\n"
		switch {
		case strings.HasPrefix(command, "USER "):
			response = "230 Logged in\r\n"
		case command == "FEAT\r\n":
			response = "500 No features\r\n"
		case command == "TYPE I\r\n":
			response = "200 Binary mode\r\n"
		case command == "EPSV\r\n":
			response = "229 Entering Extended Passive Mode (|||49152|)\r\n"
		case strings.HasPrefix(command, "LIST"):
			if err := writeProxyRequest(socket, []byte("150 Opening data\r\n")); err != nil {
				return err
			}
			close(startData)
			<-dataDone
			response = "226 Transfer complete\r\n"
		case command == "QUIT\r\n":
			return nil
		}
		if err := writeProxyRequest(socket, []byte(response)); err != nil {
			return err
		}
	}
}
