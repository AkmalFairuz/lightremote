# Protocols

The backend establishes upstream connections and forwards viewer or file data.
Browsers use WebSockets for SSH and VNC. The desktop app uses Wails streams
through the same viewer interface. See [desktop transport](desktop.md#viewer-transport).

## SSH terminal

SSH connections authenticate with a password or private key and verify the
approved SHA-256 host-key fingerprint. The backend requests an
`xterm-256color` PTY, initially 24 rows by 80 columns, and starts a shell.
SSH shell state belongs to the work session and survives viewer handoff.

| Message | Meaning |
| --- | --- |
| Browser binary | UTF-8 terminal input |
| Server binary | Terminal stdout and stderr |
| Browser text | PTY resize control |
| Server text | Ready or error control |

A resize message looks like this:

```json
{"type":"resize","rows":24,"cols":80}
```

Rows and columns must each be between 1 and 1000. Server controls use `type`
and `message` fields, such as `{"type":"ready","message":""}`.
The shell keeps up to 1 MiB of recent output for viewer replay.

## VNC desktop

The proxy authenticates the upstream RFB connection and presents a no-auth RFB
stream to the authorized viewer. The browser receives standard binary RFB
messages compatible with noVNC.

The bridge frames Raw, CopyRect, Tight, Zlib, Hextile, ZRLE, RichCursor,
DesktopSize, and LastRect updates. Encoded framebuffer payloads are forwarded
unchanged. Saved connections can prefer Auto, Raw, CopyRect, Tight, Zlib,
Hextile, or ZRLE. Raw remains available as the fallback when a preference
cannot be negotiated.

| Access setting | Desktop input | File operations |
| --- | --- | --- |
| Full access | Allowed | Allowed |
| Read only | Blocked | Blocked |
| Read only with file transfer | Blocked | Allowed |

Both read-only settings block keyboard, pointer, and browser-to-server
clipboard input at the backend. File operations also require support from
the upstream server. VNC setup failures reach the UI as viewer close reasons.

### TightVNC and UltraVNC files

File operations share the upstream RFB connection with an open desktop.
Without an active desktop bridge, the backend starts a short-lived headless
connection. TightVNC advertises file-message capabilities during the handshake.
UltraVNC uses its version and permission exchange.

TightVNC file strings use length-prefixed UTF-8 with a terminating NUL byte.
The proxy includes it in requests and removes it in replies. Older UltraVNC
servers support ASCII paths through the legacy protocol. Their local ANSI
code page cannot be inferred remotely.

Unsupported operations return HTTP 501 with `unsupported_capability`.
Disabled file transfer returns HTTP 403 with `file_transfer_disabled`.
See [remote file behavior](frontend.md#remote-file-manager) for drive paths
and file-panel controls.

## SFTP, FTP, and explicit FTPS

SFTP opens an SSH transport and SFTP subsystem for each file request. It uses
the same fingerprint checks and authentication methods as SSH. Its home route
returns the working directory reported by the SFTP server.

FTP uses a control connection and passive data connections. `ftpTls=true`
enables explicit FTPS with certificate verification and TLS 1.2 or newer.
Plain FTP sends credentials and file data without transport encryption.

The file API lists directories, finds the server working directory, downloads,
uploads, creates directories, renames entries, and deletes files or empty
directories. Uploads and downloads stream through the proxy. Uploads overwrite
the target file and use raw request bodies, subject to `MAX_UPLOAD_BYTES`.
Deletes do not recursively remove folders. Partial transfers can leave a
partial remote file.

Remote paths must be absolute POSIX paths or drive paths such as `C:/folder`.
NUL, carriage return, and newline characters are rejected. An empty listing
path resolves to `/`. Mutating routes reject the virtual root `/`.
SSH terminal connections are rejected by the file API. Use SFTP for SSH files.

## Outbound proxies

Each connection can use an HTTP, HTTPS, or SOCKS5 proxy. Include a `proxy`
object in a connection creation request, for example:

```json
{
  "proxy": {
    "type": "socks5",
    "host": "proxy.example.com",
    "port": 1080,
    "username": "alice",
    "password": "secret"
  }
}
```

Omitting `proxy` selects a direct network connection, including on update.
This routing choice is separate from the temporary direct-connection feature.
An update may omit `proxy.password` to retain an existing password only when
proxy type, host, port, and username remain unchanged. A changed authenticated
proxy requires its password. Passwords are encrypted and omitted from API
responses, which expose `hasPassword` instead.

HTTP and HTTPS use CONNECT, with optional Basic authentication. HTTPS verifies
the proxy certificate. SOCKS5 supports username/password authentication.
The proxy resolves target hostnames, including private names. Proxy errors
are returned without retrying through a direct connection.

FTP and FTPS send control and passive data connections through the same proxy.
For proxied passive data, the backend uses the configured FTP host with the
port returned by the server. The outbound address policy checks the proxy
endpoint. Targets resolved by the proxy may include private or loopback hosts.
See [outbound address checks](security.md#outbound-address-checks).

Implementation lives in [`internal/remote`](../internal/remote) and
[`internal/httpapi/work.go`](../internal/httpapi/work.go). Existing protocol
fixtures are described in [development](development.md#existing-coverage).
