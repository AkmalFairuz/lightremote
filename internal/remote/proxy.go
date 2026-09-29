package remote

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
)

const (
	maxTCPPort         = 65535
	maxSOCKSFieldBytes = 255
	socksVersion       = 5
	socksSingleMethod  = 1
	socksConnect       = 1
	socksNoAuth        = 0
	socksPasswordAuth  = 2
	socksIPv4Address   = 1
	socksDomainAddress = 3
	socksIPv6Address   = 4
)

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

// Read preserves bytes buffered while parsing an HTTP CONNECT response.
func (c *bufferedConn) Read(data []byte) (int, error) {
	return c.reader.Read(data)
}

// DialConnection opens a direct socket or tunnels through the connection's proxy.
func DialConnection(ctx context.Context, connection model.Connection, secret model.RemoteSecret, target string, timeout time.Duration) (net.Conn, error) {
	return dialConnection(ctx, connection, secret, target, timeout, DialTCP, nil)
}

// dialConnection allows the endpoint dial to be replaced in protocol tests.
func dialConnection(ctx context.Context, connection model.Connection, secret model.RemoteSecret, target string, timeout time.Duration, dialEndpoint func(context.Context, string, string, time.Duration) (net.Conn, error), roots *x509.CertPool) (net.Conn, error) {
	if connection.ProxyType == nil {
		return dialEndpoint(ctx, "tcp", target, timeout)
	}
	if connection.ProxyHost == nil || connection.ProxyPort == nil || connection.ProxyUser == nil {
		return nil, errors.New("incomplete proxy settings")
	}
	host, port, err := net.SplitHostPort(target)
	if err != nil || host == "" || strings.ContainsAny(host, "\x00\r\n\t /\\@") {
		return nil, errors.New("invalid proxy target")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > maxTCPPort {
		return nil, errors.New("invalid proxy target port")
	}
	proxyAddress := net.JoinHostPort(*connection.ProxyHost, strconv.Itoa(*connection.ProxyPort))
	socket, err := dialEndpoint(ctx, "tcp", proxyAddress, timeout)
	if err != nil {
		return nil, fmt.Errorf("connect proxy: %w", err)
	}
	rawSocket := socket
	connected := false
	defer func() {
		if !connected {
			rawSocket.Close()
		}
	}()
	if err := socket.SetDeadline(time.Now().Add(timeout)); err != nil {
		return nil, err
	}
	switch *connection.ProxyType {
	case "http", "https":
		if *connection.ProxyType == "https" {
			secure := tls.Client(socket, &tls.Config{
				MinVersion: tls.VersionTLS12,
				ServerName: *connection.ProxyHost,
				RootCAs:    roots,
			})
			if err := secure.HandshakeContext(ctx); err != nil {
				return nil, fmt.Errorf("proxy TLS: %w", err)
			}
			socket = secure
		}
		socket, err = connectHTTPProxy(socket, target, *connection.ProxyUser, secret.ProxyPassword)
	case "socks5":
		err = connectSOCKS5(socket, host, portNumber, *connection.ProxyUser, secret.ProxyPassword)
	default:
		err = errors.New("unsupported proxy type")
	}
	if err != nil {
		return nil, err
	}
	if err := socket.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	connected = true
	return socket, nil
}

// connectHTTPProxy establishes an HTTP CONNECT tunnel, optionally with Basic auth.
func connectHTTPProxy(socket net.Conn, target, username, password string) (net.Conn, error) {
	request := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n"
	if username != "" {
		token := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		request += "Proxy-Authorization: Basic " + token + "\r\n"
	}
	request += "\r\n"
	if err := writeProxyRequest(socket, []byte(request)); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(socket)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("proxy CONNECT failed with status %d", response.StatusCode)
	}
	return &bufferedConn{Conn: socket, reader: reader}, nil
}

// connectSOCKS5 negotiates SOCKS5 authentication and a remote-DNS TCP tunnel.
func connectSOCKS5(socket net.Conn, host string, port int, username, password string) error {
	method := byte(socksNoAuth)
	if username != "" {
		method = socksPasswordAuth
	}
	if err := writeProxyRequest(socket, []byte{socksVersion, socksSingleMethod, method}); err != nil {
		return err
	}
	var selection [2]byte
	if _, err := io.ReadFull(socket, selection[:]); err != nil {
		return err
	}
	if selection != [2]byte{socksVersion, method} {
		return errors.New("proxy rejected SOCKS5 authentication method")
	}
	if method == socksPasswordAuth {
		if len(username) > maxSOCKSFieldBytes || len(password) > maxSOCKSFieldBytes || password == "" {
			return errors.New("invalid SOCKS5 credentials")
		}
		auth := append([]byte{1, byte(len(username))}, username...)
		auth = append(auth, byte(len(password)))
		auth = append(auth, password...)
		if err := writeProxyRequest(socket, auth); err != nil {
			return err
		}
		var result [2]byte
		if _, err := io.ReadFull(socket, result[:]); err != nil {
			return err
		}
		if result != [2]byte{1, 0} {
			return errors.New("SOCKS5 proxy authentication failed")
		}
	}
	request := []byte{socksVersion, socksConnect, 0}
	if ip := net.ParseIP(host); ip != nil {
		if ipv4 := ip.To4(); ipv4 != nil {
			request = append(request, socksIPv4Address)
			request = append(request, ipv4...)
		} else {
			request = append(request, socksIPv6Address)
			request = append(request, ip.To16()...)
		}
	} else {
		if len(host) > maxSOCKSFieldBytes {
			return errors.New("SOCKS5 target hostname is too long")
		}
		request = append(request, socksDomainAddress, byte(len(host)))
		request = append(request, host...)
	}
	request = append(request, byte(port>>8), byte(port))
	if err := writeProxyRequest(socket, request); err != nil {
		return err
	}
	var reply [4]byte
	if _, err := io.ReadFull(socket, reply[:]); err != nil {
		return err
	}
	if reply[0] != socksVersion || reply[1] != 0 || reply[2] != 0 {
		return fmt.Errorf("SOCKS5 CONNECT failed with status %d", reply[1])
	}
	addressLength := 0
	switch reply[3] {
	case socksIPv4Address:
		addressLength = 4
	case socksIPv6Address:
		addressLength = 16
	case socksDomainAddress:
		var length [1]byte
		if _, err := io.ReadFull(socket, length[:]); err != nil {
			return err
		}
		addressLength = int(length[0])
	default:
		return errors.New("invalid SOCKS5 reply address")
	}
	_, err := io.CopyN(io.Discard, socket, int64(addressLength+2))
	return err
}

// writeProxyRequest writes every byte of a proxy handshake message.
func writeProxyRequest(socket net.Conn, data []byte) error {
	for len(data) > 0 {
		count, err := socket.Write(data)
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
		data = data[count:]
	}
	return nil
}
