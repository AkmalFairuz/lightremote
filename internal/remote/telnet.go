package remote

import (
	"errors"
	"io"
	"net"
	"sync"
)

const (
	telnetSE   = 240
	telnetSB   = 250
	telnetWILL = 251
	telnetWONT = 252
	telnetDO   = 253
	telnetDONT = 254
	telnetIAC  = 255

	telnetBinary = 0
	telnetEcho   = 1
	telnetSGA    = 3
	telnetType   = 24
	telnetNAWS   = 31

	maxTelnetSubnegotiation = 4096
)

const (
	telnetData byte = iota
	telnetCommand
	telnetOption
	telnetSubnegotiation
	telnetSubcommand
)

// TelnetConn removes protocol commands from output and escapes terminal input.
// One reader owns the parser; the mutex serializes option changes and all writes.
type TelnetConn struct {
	socket       net.Conn
	mu           sync.Mutex
	local        [256]bool
	remote       [256]bool
	deniedLocal  [256]bool
	deniedRemote [256]bool
	rows, cols   int
	inputCR      bool
	outputCR     bool
	state        byte
	command      byte
	sub          []byte
	unread       []byte
	readErr      error
	readBuffer   [32 * 1024]byte
}

// NewTelnetConn wraps a checked TCP connection without starting another reader.
func NewTelnetConn(socket net.Conn) *TelnetConn {
	return &TelnetConn{socket: socket, rows: 24, cols: 80}
}

func (c *TelnetConn) Read(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	for len(c.unread) == 0 {
		if c.readErr != nil {
			return 0, c.readErr
		}
		n, err := c.socket.Read(c.readBuffer[:])
		c.readErr = err
		if n > 0 {
			c.mu.Lock()
			output, parseErr := c.parse(c.readBuffer[:n])
			c.mu.Unlock()
			if parseErr != nil {
				return 0, parseErr
			}
			c.unread = output
		}
		if len(c.unread) > 0 {
			break
		}
		if err != nil {
			return 0, err
		}
	}
	n := copy(buffer, c.unread)
	c.unread = c.unread[n:]
	return n, nil
}

// parse retains command state across arbitrary TCP read boundaries.
func (c *TelnetConn) parse(input []byte) ([]byte, error) {
	output := make([]byte, 0, len(input))
	for _, b := range input {
		switch c.state {
		case telnetData:
			if b == telnetIAC {
				c.state = telnetCommand
			} else {
				output = c.appendOutput(output, b)
			}
		case telnetCommand:
			c.state = telnetData
			switch b {
			case telnetIAC:
				output = c.appendOutput(output, b)
			case telnetWILL, telnetWONT, telnetDO, telnetDONT:
				c.command = b
				c.state = telnetOption
			case telnetSB:
				c.sub = c.sub[:0]
				c.state = telnetSubnegotiation
			}
		case telnetOption:
			c.state = telnetData
			if err := c.negotiate(c.command, b); err != nil {
				return nil, err
			}
		case telnetSubnegotiation:
			if b == telnetIAC {
				c.state = telnetSubcommand
			} else {
				c.sub = append(c.sub, b)
			}
		case telnetSubcommand:
			switch b {
			case telnetSE:
				c.state = telnetData
				if err := c.subnegotiate(); err != nil {
					return nil, err
				}
				c.sub = c.sub[:0]
			case telnetIAC:
				c.sub = append(c.sub, b)
				c.state = telnetSubnegotiation
			default:
				return nil, errors.New("invalid Telnet subnegotiation")
			}
		}
		if len(c.sub) > maxTelnetSubnegotiation {
			return nil, errors.New("Telnet subnegotiation is too large")
		}
	}
	return output, nil
}

func (c *TelnetConn) appendOutput(output []byte, b byte) []byte {
	if !c.remote[telnetBinary] && c.outputCR && b == 0 {
		c.outputCR = false
		return output
	}
	c.outputCR = !c.remote[telnetBinary] && b == '\r'
	return append(output, b)
}

// negotiate acknowledges transitions only, avoiding repeated negotiation loops.
// Options are server initiated; unsupported offers are refused once until reset.
func (c *TelnetConn) negotiate(command, option byte) error {
	switch command {
	case telnetWILL:
		if option != telnetBinary && option != telnetEcho && option != telnetSGA {
			if !c.deniedRemote[option] {
				c.deniedRemote[option] = true
				return c.writeAll([]byte{telnetIAC, telnetDONT, option})
			}
			return nil
		}
		if !c.remote[option] {
			c.remote[option] = true
			return c.writeAll([]byte{telnetIAC, telnetDO, option})
		}
	case telnetWONT:
		c.deniedRemote[option] = false
		if c.remote[option] {
			c.remote[option] = false
			return c.writeAll([]byte{telnetIAC, telnetDONT, option})
		}
	case telnetDO:
		if option != telnetBinary && option != telnetSGA && option != telnetType && option != telnetNAWS {
			if !c.deniedLocal[option] {
				c.deniedLocal[option] = true
				return c.writeAll([]byte{telnetIAC, telnetWONT, option})
			}
			return nil
		}
		if !c.local[option] {
			c.local[option] = true
			if err := c.writeAll([]byte{telnetIAC, telnetWILL, option}); err != nil {
				return err
			}
			if option == telnetNAWS {
				return c.sendSize()
			}
		}
	case telnetDONT:
		c.deniedLocal[option] = false
		if c.local[option] {
			c.local[option] = false
			return c.writeAll([]byte{telnetIAC, telnetWONT, option})
		}
	}
	return nil
}

func (c *TelnetConn) subnegotiate() error {
	if len(c.sub) == 2 && c.sub[0] == telnetType && c.sub[1] == 1 && c.local[telnetType] {
		return c.sendSubnegotiation(append([]byte{telnetType, 0}, []byte("xterm-256color")...))
	}
	return nil
}

// Write sends xterm input, encoding Enter and pasted newlines as NVT CR LF.
// Negotiated binary mode preserves all bytes except IAC escaping.
func (c *TelnetConn) Write(input []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	output := make([]byte, 0, len(input)*2)
	for _, b := range input {
		if !c.local[telnetBinary] {
			if b == '\n' && c.inputCR {
				c.inputCR = false
				continue
			}
			c.inputCR = b == '\r'
			if b == '\r' || b == '\n' {
				output = append(output, '\r', '\n')
				continue
			}
		} else {
			c.inputCR = false
		}
		output = append(output, b)
		if b == telnetIAC {
			output = append(output, b)
		}
	}
	if err := c.writeAll(output); err != nil {
		return 0, err
	}
	return len(input), nil
}

func (c *TelnetConn) Resize(rows, cols int) error {
	if rows < 1 || cols < 1 || rows > 65535 || cols > 65535 {
		return errors.New("invalid Telnet terminal size")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows, c.cols = rows, cols
	if c.local[telnetNAWS] {
		return c.sendSize()
	}
	return nil
}

func (c *TelnetConn) sendSize() error {
	return c.sendSubnegotiation([]byte{telnetNAWS, byte(c.cols >> 8), byte(c.cols), byte(c.rows >> 8), byte(c.rows)})
}

func (c *TelnetConn) sendSubnegotiation(payload []byte) error {
	frame := []byte{telnetIAC, telnetSB}
	for _, b := range payload {
		frame = append(frame, b)
		if b == telnetIAC {
			frame = append(frame, b)
		}
	}
	return c.writeAll(append(frame, telnetIAC, telnetSE))
}

func (c *TelnetConn) writeAll(payload []byte) error {
	for len(payload) > 0 {
		n, err := c.socket.Write(payload)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		payload = payload[n:]
	}
	return nil
}

func (c *TelnetConn) Close() error {
	return c.socket.Close()
}
