# Configuration

The standalone backend loads an optional `.env` in its working directory with
`godotenv`, then parses typed settings with `caarlos0/env`. Process environment
variables take precedence over `.env` values.

Defaults below come from [the configuration code](../internal/config/config.go).
The [example environment file](../.env.example) supplies sample values for
several settings that have empty defaults.

## Server settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | HTTP listening address |
| `FRONTEND_DIR` | Empty | Optional built frontend directory; unset means API-only serving |
| `LOCAL_MODE` | `false` | Use a stable local owner without account login |
| `DATABASE_DRIVER` | `sqlite` | Select `sqlite` or `mysql` |
| `SQLITE_PATH` | `./lightremote.db` | Database file relative to the working directory |
| `ENCRYPTION_KEY` | Required | Base64-encoded 32-byte credential encryption key |
| `ADMIN_EMAIL` | `admin@localhost` | Email for the initial administrator |
| `ADMIN_PASSWORD` | Empty | Required in account mode until an administrator exists |
| `PUBLIC_ORIGIN` | Empty | Allowed browser origin for WebSocket connections |
| `COOKIE_SECURE` | `true` | Require HTTPS for the login cookie |
| `SESSION_TTL` | `24h` | Account login-session lifetime |
| `MAX_UPLOAD_BYTES` | `1073741824` | Maximum body size for one remote file upload, 1 GiB |
| `DIAL_TIMEOUT` | `10s` | Timeout for outbound connection setup |

`SESSION_TTL`, `MAX_UPLOAD_BYTES`, and `DIAL_TIMEOUT` must be positive.
Durations use Go duration syntax such as `10s` and `24h`. The vault validates
the decoded encryption key during startup.

When `FRONTEND_DIR` is set, the standalone server requires a readable
`index.html` in that directory and serves the browser workspace on the same
origin as the API. Browser navigation uses an SPA fallback, while missing
assets return 404. `/api` and `/healthz` keep their existing routing. The
Docker image sets this path automatically; see [Docker deployment](docker.md).

`PUBLIC_ORIGIN` must start with `http://` or `https://`. Use the exact browser
origin, including its port. With an empty value, WebSocket validation compares
the browser Origin host with the request Host. Local mode uses that Host-based
check and ignores `PUBLIC_ORIGIN`.

`LOCAL_MODE=true` requires an explicit loopback IP in `LISTEN_ADDR`, such as
`127.0.0.1:8080` or `[::1]:8080`. Local HTTP hosts may be loopback IPs or
`localhost`. See [security](security.md#local-mode).

`ENCRYPTION_KEY` is required by the server configuration loader for migration
commands as well. Keep the original key to decrypt saved credentials.

## Database settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYSQL_HOST` | Empty | MySQL host |
| `MYSQL_PORT` | `3306` | MySQL TCP port |
| `MYSQL_USER` | Empty | Database user |
| `MYSQL_PASSWORD` | Empty | Database password |
| `MYSQL_DATABASE` | Empty | Existing database name |

MySQL mode requires nonempty host, user, password, and database values. Its port
must be between 1 and 65535. SQLite mode requires a nonempty `SQLITE_PATH`.
Parent directories for a custom SQLite file should already exist.

## Frontend and desktop settings

The browser build uses relative API URLs. Its development proxy targets
`http://127.0.0.1:8080` in [the Vite config](../frontend/vite.config.ts).

| Variable | Use |
| --- | --- |
| `VITE_DESKTOP` | Build-time flag set to `true` by Wails tasks to enable native integration |
| `WAILS_VITE_PORT` | Development frontend port, used by Wails tasks and Vite |
| `XDG_DATA_HOME` | Base directory for desktop data on Linux |
| `LOCALAPPDATA` | Base directory for desktop data on Windows |

Normal web development uses port 5173. The root Wails task defaults to port
9245 and requires the selected Vite port to be available.

The desktop app bypasses the server environment loader. It provisions SQLite,
a persistent `vault.key`, local mode, a 1 GiB upload limit, and a 10-second dial
timeout. Server `.env` settings do not configure the desktop app. See
[desktop data](desktop.md#data-and-backups).
