package remote

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"golang.org/x/crypto/ssh"
)

var ErrUnapprovedHostKey = errors.New("SSH host key is not approved")
var ErrChangedHostKey = errors.New("SSH host key differs from the approved fingerprint")

// DialTCP resolves and checks the destination before opening an outbound socket.
func DialTCP(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error) {
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(dialCtx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: timeout}
	var lastDialError error
	for _, resolved := range ips {
		ip := resolved.IP
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
			ip.IsUnspecified() || ip.IsMulticast() {
			continue
		}
		target := net.JoinHostPort(ip.String(), port)
		conn, err := dialer.DialContext(dialCtx, network, target)
		if err == nil {
			return conn, nil
		}
		lastDialError = err
	}
	if lastDialError != nil {
		return nil, fmt.Errorf("could not connect to %s: %w", address, lastDialError)
	}
	return nil, fmt.Errorf("no permitted reachable address for %s", host)
}

// Address returns the network address configured for a remote connection.
func Address(connection model.Connection) string {
	return net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port))
}

// InspectSSHHostKey reads a server's fingerprint without trusting or authenticating it.
func InspectSSHHostKey(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (string, error) {
	var fingerprint string
	callback := func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		return ErrUnapprovedHostKey
	}
	socket, err := DialConnection(ctx, connection, secret, Address(connection), timeout)
	if err != nil {
		return "", err
	}
	defer socket.Close()
	if err := socket.SetDeadline(time.Now().Add(timeout)); err != nil {
		return "", err
	}
	config := &ssh.ClientConfig{
		User:            connection.Username,
		HostKeyCallback: callback,
		Timeout:         timeout,
	}
	_, _, _, err = ssh.NewClientConn(socket, Address(connection), config)
	if fingerprint != "" {
		return fingerprint, nil
	}
	return "", err
}

// DialSSH verifies the saved fingerprint and authenticates with a password or private key.
func DialSSH(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration) (*ssh.Client, error) {
	if connection.HostKey == nil {
		return nil, ErrUnapprovedHostKey
	}
	callback := func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != *connection.HostKey {
			return ErrChangedHostKey
		}
		return nil
	}
	return newSSHClient(ctx, connection, secret, timeout, callback)
}

// newSSHClient dials a checked target and applies the caller's host-key policy.
func newSSHClient(ctx context.Context, connection model.Connection, secret model.RemoteSecret, timeout time.Duration, callback ssh.HostKeyCallback) (*ssh.Client, error) {
	authMethods := []ssh.AuthMethod{}
	if connection.AuthType == "private_key" {
		var signer ssh.Signer
		var err error
		if secret.Passphrase == "" {
			signer, err = ssh.ParsePrivateKey([]byte(secret.PrivateKey))
		} else {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(
				[]byte(secret.PrivateKey), []byte(secret.Passphrase))
		}
		if err != nil {
			return nil, err
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else if connection.AuthType == "password" {
		authMethods = append(authMethods, ssh.Password(secret.Password))
	}

	socket, err := DialConnection(ctx, connection, secret, Address(connection), timeout)
	if err != nil {
		return nil, err
	}
	if err := socket.SetDeadline(time.Now().Add(timeout)); err != nil {
		socket.Close()
		return nil, err
	}
	config := &ssh.ClientConfig{
		User:            connection.Username,
		Auth:            authMethods,
		HostKeyCallback: callback,
		Timeout:         timeout,
	}
	clientConn, channels, requests, err := ssh.NewClientConn(socket, Address(connection), config)
	if err != nil {
		socket.Close()
		return nil, err
	}
	if err := socket.SetDeadline(time.Time{}); err != nil {
		clientConn.Close()
		return nil, err
	}
	return ssh.NewClient(clientConn, channels, requests), nil
}
