package remote

import (
	"bufio"
	"crypto/des"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"net"
	"strconv"
	"strings"
)

const (
	rfbVersionBytes          = 12
	rfbServerInitHeaderBytes = 24
	maxVNCDesktopNameBytes   = 1 << 20
	maxTightSecurityOptions  = 256
	maxTightCapabilities     = 4096
)

type vncInit struct {
	serverInit   []byte
	serverName   string
	pixelBits    uint8
	caps         map[uint32]bool
	ultraOffered bool
}

// authenticateVNC completes the upstream RFB handshake and reads Tight capabilities.
func authenticateVNC(conn net.Conn, reader *bufio.Reader, password string) (vncInit, error) {
	var result vncInit
	version := make([]byte, rfbVersionBytes)
	if _, err := io.ReadFull(reader, version); err != nil {
		return result, err
	}
	if !strings.HasPrefix(string(version), "RFB 003.") {
		return result, errors.New("unsupported RFB protocol version")
	}
	minor, err := strconv.Atoi(string(version[8:11]))
	if err != nil || (minor != 3 && minor != 4 && minor != 6 && minor != 7 && minor != 8) {
		return result, errors.New("unsupported RFB protocol version")
	}
	if _, err := conn.Write(version); err != nil {
		return result, err
	}

	securityType, tight, err := chooseVNCSecurity(conn, reader, minor, password, &result.ultraOffered)
	if err != nil {
		return result, err
	}
	if securityType == rfbSecurityVNCAuth {
		if err := respondVNCChallenge(conn, reader, password); err != nil {
			return result, err
		}
	}
	if minor >= 8 || securityType == rfbSecurityVNCAuth {
		var status uint32
		if err := binary.Read(reader, binary.BigEndian, &status); err != nil {
			return result, err
		}
		if status != 0 {
			return result, errors.New("VNC authentication failed")
		}
	}
	if _, err := conn.Write([]byte{1}); err != nil {
		return result, err
	}

	header := make([]byte, rfbServerInitHeaderBytes)
	if _, err := io.ReadFull(reader, header); err != nil {
		return result, err
	}
	nameLength := binary.BigEndian.Uint32(header[20:24])
	if nameLength > maxVNCDesktopNameBytes {
		return result, errors.New("VNC desktop name is too long")
	}
	result.serverInit = append(result.serverInit, header...)
	name := make([]byte, nameLength)
	if _, err := io.ReadFull(reader, name); err != nil {
		return result, err
	}
	result.serverInit = append(result.serverInit, name...)
	result.serverName = string(name)
	result.pixelBits = header[4]
	result.caps = make(map[uint32]bool)
	if tight {
		if err := readTightCapabilities(reader, result.caps); err != nil {
			return result, err
		}
	}
	return result, nil
}

// chooseVNCSecurity selects standard or Tight security according to the saved password.
func chooseVNCSecurity(conn net.Conn, reader *bufio.Reader, minor int, password string, ultraOffered *bool) (uint32, bool, error) {
	var types []byte
	if minor < 7 {
		var selected uint32
		if err := binary.Read(reader, binary.BigEndian, &selected); err != nil {
			return 0, false, err
		}
		types = []byte{byte(selected)}
	} else {
		count, err := reader.ReadByte()
		if err != nil {
			return 0, false, err
		}
		if count == 0 {
			return 0, false, errors.New("VNC server offered no security types")
		}
		types = make([]byte, count)
		if _, err := io.ReadFull(reader, types); err != nil {
			return 0, false, err
		}
	}
	*ultraOffered = containsByte(types, rfbSecurityUltraVNC)

	want := byte(rfbSecurityNone)
	if password != "" {
		want = rfbSecurityVNCAuth
	}
	selected := byte(0)
	if minor >= 7 && containsByte(types, rfbSecurityTight) {
		selected = rfbSecurityTight
	} else if containsByte(types, want) {
		selected = want
	}
	if selected == 0 {
		return 0, false, errors.New("VNC server does not offer the configured security type")
	}
	if minor >= 7 {
		if _, err := conn.Write([]byte{selected}); err != nil {
			return 0, false, err
		}
	}
	if selected != rfbSecurityTight {
		return uint32(selected), false, nil
	}
	authType, err := chooseTightSecurity(conn, reader, want)
	return authType, true, err
}

// chooseTightSecurity negotiates no tunnel and None or VNC password authentication.
func chooseTightSecurity(conn net.Conn, reader *bufio.Reader, want byte) (uint32, error) {
	var tunnelCount uint32
	if err := binary.Read(reader, binary.BigEndian, &tunnelCount); err != nil {
		return 0, err
	}
	if tunnelCount > maxTightSecurityOptions {
		return 0, errors.New("too many TightVNC tunneling capabilities")
	}
	noTunnel := tunnelCount == 0
	for index := uint32(0); index < tunnelCount; index++ {
		var capability [16]byte
		if _, err := io.ReadFull(reader, capability[:]); err != nil {
			return 0, err
		}
		if binary.BigEndian.Uint32(capability[:4]) == 0 {
			noTunnel = true
		}
	}
	if !noTunnel {
		return 0, errors.New("TightVNC server requires an unsupported tunnel")
	}
	if tunnelCount > 0 {
		if err := binary.Write(conn, binary.BigEndian, uint32(0)); err != nil {
			return 0, err
		}
	}

	var authCount uint32
	if err := binary.Read(reader, binary.BigEndian, &authCount); err != nil {
		return 0, err
	}
	if authCount > maxTightSecurityOptions {
		return 0, errors.New("too many TightVNC authentication capabilities")
	}
	if authCount == 0 {
		if want != rfbSecurityNone {
			return 0, errors.New("VNC server does not require the configured password")
		}
		return 1, nil
	}
	found := false
	for index := uint32(0); index < authCount; index++ {
		var capability [16]byte
		if _, err := io.ReadFull(reader, capability[:]); err != nil {
			return 0, err
		}
		if binary.BigEndian.Uint32(capability[:4]) == uint32(want) {
			found = true
		}
	}
	if !found {
		return 0, errors.New("TightVNC server does not offer the configured authentication type")
	}
	if err := binary.Write(conn, binary.BigEndian, uint32(want)); err != nil {
		return 0, err
	}
	return uint32(want), nil
}

// respondVNCChallenge applies the RFB password challenge algorithm.
func respondVNCChallenge(conn net.Conn, reader *bufio.Reader, password string) error {
	var challenge [16]byte
	if _, err := io.ReadFull(reader, challenge[:]); err != nil {
		return err
	}
	var key [8]byte
	copy(key[:], []byte(password))
	// RFB's DES key reverses the bit order of each password byte.
	for index := range key {
		key[index] = bits.Reverse8(key[index])
	}
	block, err := des.NewCipher(key[:])
	if err != nil {
		return err
	}
	var response [16]byte
	block.Encrypt(response[:8], challenge[:8])
	block.Encrypt(response[8:], challenge[8:])
	_, err = conn.Write(response[:])
	return err
}

// readTightCapabilities records the advertised file-transfer message codes.
func readTightCapabilities(reader *bufio.Reader, capabilities map[uint32]bool) error {
	var header [8]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return err
	}
	serverCount := binary.BigEndian.Uint16(header[:2])
	clientCount := binary.BigEndian.Uint16(header[2:4])
	encodingCount := binary.BigEndian.Uint16(header[4:6])
	total := int(serverCount) + int(clientCount) + int(encodingCount)
	if total > maxTightCapabilities {
		return errors.New("too many TightVNC capabilities")
	}
	for index := 0; index < total; index++ {
		var capability [16]byte
		if _, err := io.ReadFull(reader, capability[:]); err != nil {
			return err
		}
		if string(capability[4:8]) == "TGHT" {
			capabilities[binary.BigEndian.Uint32(capability[:4])] = true
		}
	}
	return nil
}

// containsByte checks the compact security-type list sent by RFB servers.
func containsByte(values []byte, needle byte) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

// vncProtocolError labels an RFB framing or negotiation error.
func vncProtocolError(format string, values ...any) error {
	return fmt.Errorf("RFB protocol: "+format, values...)
}
