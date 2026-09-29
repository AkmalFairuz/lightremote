# LightRemote

LightRemote is a Go proxy for browser-based SSH, VNC, SFTP, FTP, and explicit
FTPS. The React frontend lives in [frontend](frontend/README.md), and the
backend contract is documented in the [OpenAPI specification](api/openapi.json).

## Run

1. Copy `.env.example` to `.env`. SQLite is the default database and stores
   data at `./lightremote.db` relative to the process working directory.
   Set `SQLITE_PATH` to use another file. Set `ADMIN_PASSWORD` and
   `ENCRYPTION_KEY`. Generate a 32-byte encryption key with
   `openssl rand -base64 32`. The key must be kept across restarts; changing it
   makes saved remote credentials unreadable.
2. Run `go run ./cmd/lightremote`. The backend creates its tables and the first
   admin account on startup. After that, `ADMIN_PASSWORD` can be removed.

## Desktop app

The Wails v3 desktop app uses the same workspace and REST API in local mode.
It runs without a separate HTTP server or login. Its SSH and VNC viewers use
Wails streams; the browser version continues to use WebSockets.

Install Go 1.26, Node.js, the [platform dependencies](https://v3.wails.io/getting-started/installation/),
and the pinned CLI:

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.26
cd frontend && npm ci && cd ..
wails3 build
```

`wails3 dev` starts the desktop development build. The compiled executable
is written under `bin/`. GitHub Actions builds amd64 and arm64 on native
macOS, Windows, and Linux runners and uploads each compiled app as an artifact.
The desktop app creates its own SQLite database and vault key in
`~/Library/Application Support/LightRemote` on macOS,
`%LOCALAPPDATA%\LightRemote` on Windows, or
`${XDG_DATA_HOME:-~/.local/share}/lightremote` on Linux. Keep both files when
backing up data; losing the key makes saved credentials unreadable. Desktop
data is separate from the web server's database and ignores the server's
`.env` settings.

For a single-person installation without login, set `LOCAL_MODE=true` and
`LISTEN_ADDR=127.0.0.1:8080`. Keep `ENCRYPTION_KEY` set so saved remote
credentials remain readable across restarts. Local mode creates one stable
internal owner for connections and folders; it does not require
`ADMIN_PASSWORD` or create login sessions. The frontend opens directly to the
workspace and hides the Account menu. Login, password, and user-management
API routes are unavailable. Local mode only starts when `LISTEN_ADDR` uses a
loopback IP; do not expose it through a reverse proxy. Existing account data
stays in the database but belongs to those accounts, so it does not appear in
the local workspace. Switching back to account mode makes that data available
to its accounts again.

To use MySQL instead, create a database with a UTF-8 character set and set
`DATABASE_DRIVER=mysql`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, and `MYSQL_DATABASE`:

```sql
CREATE DATABASE lightremote CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

MySQL and SQLite use separate data. Changing `DATABASE_DRIVER` does not copy
accounts, connections, or other records between them.

Schema changes live in `internal/store/migrations`. Each version implements
`Up` and `Down`. Normal startup applies pending versions. To run migrations
without starting the server, use `go run ./cmd/lightremote migrate up`.
With the server stopped, `go run ./cmd/lightremote migrate down` rolls back
one version. Rolling back version 3 removes saved VNC encoding and access settings;
rolling back version 2 removes saved proxy settings; rolling back version 1
removes the application tables and their data.

`godotenv` loads an optional `.env`; process environment variables win over
values in the file. `caarlos0/env` validates the typed configuration.
Both engines are accessed through `sqlx`. MySQL uses `go-sql-driver/mysql`;
SQLite uses `modernc.org/sqlite` from the cznic/sqlite project. The server
uses UTC for database timestamps and enables SQLite foreign keys on every
connection.

In account mode, use HTTPS at the reverse proxy and set `PUBLIC_ORIGIN` to the browser origin.
For local HTTP development, set `COOKIE_SECURE=false`. Login returns a
`csrfToken`; send it as `X-CSRF-Token` on all mutating requests. The login
cookie is HttpOnly and is also used for WebSocket authentication. In local mode,
`/api/auth/me` returns the local identity and a process-scoped CSRF token
without a cookie. Mutating requests still send that token; WebSockets still
check the browser origin.

## Protocol behavior

- SSH terminal WebSockets use binary messages for terminal input and output.
  Send a text message such as `{"type":"resize","rows":24,"cols":80}` to
  resize the PTY. Server text messages report errors.
- VNC WebSockets carry a standard binary RFB stream compatible with noVNC.
  The backend authenticates upstream and presents a no-auth RFB stream to the
  already authenticated browser. It frames Raw, CopyRect, Tight, Zlib,
  Hextile, ZRLE, RichCursor, DesktopSize, and LastRect updates. Saved VNC
  connections can prefer one of these framebuffer encodings or use Auto;
  unsupported preferences fall back to Raw. Encoded framebuffer data is
  forwarded unchanged to the browser. VNC access can be Full access, Read
  only, or Read only with file transfer. Both read-only modes block keyboard,
  pointer, and browser-to-server clipboard input. Full access and Read only
  with file transfer allow VNC file operations.
- TightVNC and UltraVNC file operations use the same upstream RFB connection
  as an open desktop session. Without a desktop session, a short-lived
  headless connection performs the request. TightVNC advertises file-message
  capabilities during its handshake; UltraVNC uses its version and permission
  exchange. Older UltraVNC servers can transfer ASCII paths through their
  legacy protocol; their local ANSI code page cannot be inferred remotely.
  TightVNC's length-prefixed UTF-8 file strings include a terminating NUL
  byte, which the proxy removes from replies and includes in requests.
- SFTP uses a saved SSH host-key fingerprint. Inspect a new fingerprint and
  approve that exact value before connecting. FTP is plain text unless
  `ftpTls` is true, in which case explicit FTPS verifies the server
  certificate.
- File uploads and downloads stream through the proxy. Deletes remove one
  file or an empty directory; they do not recursively remove folders.
- Each saved connection can use an HTTP, HTTPS, or SOCKS5 outbound proxy. For
  example, add `"proxy":{"type":"socks5","host":"proxy.example.com",`
  `"port":1080,"username":"alice","password":"secret"}` to a connection
  create request. Omit `proxy` for a direct connection. On update, omit
  `proxy.password` only when the proxy type, host, port, and username are
  unchanged; omit `proxy` to switch back to direct access. Passwords are
  encrypted and never returned by the API.
- HTTP and HTTPS proxies use CONNECT; HTTPS verifies the proxy certificate.
  SOCKS5 supports username/password authentication. The proxy resolves target
  hostnames, including private names. Proxied targets may be private or
  loopback addresses, while proxy endpoints must pass the backend's outbound
  address checks. FTP and FTPS send both control and passive data connections
  through the selected proxy. A proxy error never triggers a direct retry.

Connection lists, folders, users, encrypted credentials, login sessions, and
SSH fingerprints live in the selected database. Live SSH/VNC sessions and a
bounded non-secret connection cache live in process memory. A user can reserve 32
SSH/VNC sessions. Moving an SSH tab between windows preserves its shell;
moving a VNC tab opens a fresh VNC connection. A session without a viewer expires
after two minutes; closing its tab releases it immediately.

## Development

Run `go test ./cmd/lightremote ./internal/...` and
`go vet ./cmd/lightremote ./internal/...`.
