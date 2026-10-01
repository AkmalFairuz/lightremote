# Getting started

## Requirements

Use Go 1.26 and Node.js 22, matching the desktop CI toolchains. The Go module
declares Go 1.25.8. Web development uses npm for the frontend dependencies.
Desktop builds also need the [native platform dependencies](desktop.md#build).

## Run the web workspace

Run these commands at the repository root:

```sh
cp .env.example .env
```

Edit `.env` before starting the backend:

- Leave `ENCRYPTION_KEY` empty to generate and persist `vault.key` beside the
  SQLite database. Startup logs a warning; keep the file with database backups.
  Alternatively, supply a base64-encoded 32-byte key and keep that value stable.
- Leave `ADMIN_PASSWORD` empty to create the administrator in the first-run
  installation screen. Optionally set it and `ADMIN_EMAIL` to provision the
  administrator from configuration instead. Passwords need at least six bytes.
- Set `PUBLIC_ORIGIN=http://localhost:5173` for the frontend URL used below.

Start the backend:

```sh
go run ./cmd/lightremote
```

Startup applies database migrations and prepares the credential vault. With
no account and no configured admin password, installation remains pending until
you choose an email and password in the browser. Existing accounts are preserved.
SQLite stores data at `./lightremote.db` relative to the backend's
working directory. `SQLITE_PATH` selects another file.

In a second terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173` and complete installation, or sign in if an account
already exists.
Vite forwards `/api` and `/healthz` to `http://127.0.0.1:8080`, including
WebSockets. All browser requests stay on the frontend origin. Choose another
frontend port only after updating `PUBLIC_ORIGIN` to match. A changed backend
address also requires updating the Vite proxy target.

## Local mode

For a single-person web installation, use these settings:

```dotenv
LOCAL_MODE=true
LISTEN_ADDR=127.0.0.1:8080
```

The same explicit or generated encryption key is used in local mode.
Local mode creates one stable internal owner and opens
the workspace without login or an Account menu. It requires no admin password.
Login, logout, password, and user-management routes are unavailable. The
frontend still obtains a CSRF token through `/api/auth/me`.

Use a loopback IP in `LISTEN_ADDR`. A hostname such as `localhost` fails the
startup validation. Keep local mode accessible only through the local machine
and avoid publishing it through a reverse proxy. Local mode checks request
hosts and origins against the local address.

Existing account records stay in the database under their original owners.
Switching modes changes the visible workspace without moving those records.
Account mode restores access through the corresponding accounts.

The [desktop app](desktop.md) provisions its own local-mode configuration and
data directory.

## MySQL

Create a database before starting LightRemote. For example, run this statement
through your MySQL client:

```sql
CREATE DATABASE lightremote CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
```

Set `DATABASE_DRIVER=mysql`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, and `MYSQL_DATABASE`. The SQLite and MySQL databases have
separate data. Changing the driver does not copy records between them.

See [configuration](configuration.md) for the complete settings and
[storage](storage.md) for migrations and backups.

## Web deployment

For a single-container deployment with the frontend included, see
[Docker deployment](docker.md).

Build the frontend:

```sh
cd frontend
npm ci
npm run build
```

Set `FRONTEND_DIR=./frontend/dist` when running the standalone Go server from
the repository root to serve the frontend and API together. With this setting
unset, the Go server serves only the API and health check. You can instead
serve `frontend/dist/` through a static host with an SPA fallback to
`index.html`, including `/detached/*`.

Route `/api` and `/healthz` to the backend on the same public origin. Allow
WebSocket upgrades under `/api/sessions/*/ws`. Use HTTPS at the reverse proxy,
set `PUBLIC_ORIGIN` to the browser origin.
Account mode supports this deployment.

`GET /healthz` checks database connectivity. A healthy response is HTTP 204.
Database failures return HTTP 503. Remote server reachability is checked when
a connection is used.
