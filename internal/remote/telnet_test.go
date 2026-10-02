package remote

import (
	"bytes"
	"io"
	"net"
	"testing"
)

type telnetTestSocket struct {
	net.Conn
	input  *bytes.Reader
	output bytes.Buffer
}

func (s *telnetTestSocket) Read(p []byte) (int, error) {
	// Exercise command, CR and subnegotiation boundaries on every byte.
	return s.input.Read(p[:1])
}

func (s *telnetTestSocket) Write(p []byte) (int, error) {
	// Exercise short writes for both terminal input and negotiation replies.
	if len(p) > 2 {
		p = p[:2]
	}
	return s.output.Write(p)
}

func (s *telnetTestSocket) Close() error {
	return nil
}

func TestTelnetFragmentedNegotiationAndOutput(t *testing.T) {
	input := []byte{telnetIAC, telnetWILL, telnetEcho, telnetIAC, telnetWILL, telnetEcho,
		telnetIAC, telnetDO, telnetType,
		telnetIAC, telnetSB, telnetType, 1, telnetIAC, telnetSE,
		telnetIAC, telnetDO, telnetNAWS, telnetIAC, telnetDO, telnetNAWS,
		telnetIAC, telnetWILL, 99, telnetIAC, telnetWILL, 99,
		telnetIAC, telnetDO, telnetEcho, telnetIAC, telnetDO, telnetEcho,
		telnetIAC, telnetSB, 99, telnetIAC, telnetIAC, telnetIAC, telnetSE}
	input = append(input, []byte("login:\r\x00\n")...)
	input = append(input, telnetIAC, telnetIAC)
	socket := &telnetTestSocket{input: bytes.NewReader(input)}
	conn := NewTelnetConn(socket)
	if err := conn.Resize(40, 255); err != nil {
		t.Fatal(err)
	}
	output, err := io.ReadAll(conn)
	if err != nil || !bytes.Equal(output, append([]byte("login:\r\n"), telnetIAC)) {
		t.Fatalf("decoded output %q, error %v", output, err)
	}
	want := []byte{telnetIAC, telnetDO, telnetEcho, telnetIAC, telnetWILL, telnetType,
		telnetIAC, telnetSB, telnetType, 0}
	want = append(want, []byte("xterm-256color")...)
	want = append(want, telnetIAC, telnetSE, telnetIAC, telnetWILL, telnetNAWS,
		telnetIAC, telnetSB, telnetNAWS, 0, 255, 255, 0, 40, telnetIAC, telnetSE,
		telnetIAC, telnetDONT, 99, telnetIAC, telnetWONT, telnetEcho)
	if !bytes.Equal(socket.output.Bytes(), want) {
		t.Fatalf("negotiation replies %v, want %v", socket.output.Bytes(), want)
	}
	socket.output.Reset()
	if err := conn.Resize(30, 100); err != nil {
		t.Fatal(err)
	}
	if want := []byte{255, 250, 31, 0, 100, 0, 30, 255, 240}; !bytes.Equal(socket.output.Bytes(), want) {
		t.Fatalf("resize reply %v, want %v", socket.output.Bytes(), want)
	}
}

func TestTelnetBinaryAndNVTInput(t *testing.T) {
	socket := &telnetTestSocket{input: bytes.NewReader(nil)}
	conn := NewTelnetConn(socket)
	for _, input := range [][]byte{[]byte("ls\r"), []byte("\npwd\n"), {255}} {
		if n, err := conn.Write(input); err != nil || n != len(input) {
			t.Fatalf("write returned %d, %v", n, err)
		}
	}
	if want := append([]byte("ls\r\npwd\r\n"), 255, 255); !bytes.Equal(socket.output.Bytes(), want) {
		t.Fatalf("NVT input %q, want %q", socket.output.Bytes(), want)
	}
	if _, err := conn.parse([]byte{255, telnetDO, telnetBinary, 255, telnetWILL, telnetBinary}); err != nil {
		t.Fatal(err)
	}
	socket.output.Reset()
	input := []byte{'\r', 0, '\n', 255}
	if _, err := conn.Write(input); err != nil {
		t.Fatal(err)
	}
	if want := append(append([]byte(nil), input...), 255); !bytes.Equal(socket.output.Bytes(), want) {
		t.Fatalf("binary input changed: %v", socket.output.Bytes())
	}
	output, err := conn.parse([]byte{'\r', 0, '\n'})
	if err != nil || !bytes.Equal(output, []byte{'\r', 0, '\n'}) {
		t.Fatalf("binary output changed: %v, %v", output, err)
	}
	if _, err := conn.parse([]byte{255, telnetDONT, telnetBinary, 255, telnetWONT, telnetBinary}); err != nil {
		t.Fatal(err)
	}
	socket.output.Reset()
	if _, err := conn.Write([]byte("\r")); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(socket.output.Bytes(), []byte("\r\n")) {
		t.Fatal("binary disable did not restore NVT Enter handling")
	}
}

func TestTelnetBoundsSubnegotiation(t *testing.T) {
	input := append([]byte{255, telnetSB, 99}, bytes.Repeat([]byte{'x'}, maxTelnetSubnegotiation)...)
	socket := &telnetTestSocket{input: bytes.NewReader(input)}
	if _, err := io.ReadAll(NewTelnetConn(socket)); err == nil {
		t.Fatal("unbounded subnegotiation was accepted")
	}
}
