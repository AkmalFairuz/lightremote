# Storage

## Database engines

SQLite is the default engine, using `modernc.org/sqlite`. MySQL uses
`go-sql-driver/mysql`. Both are accessed through SQLx repositories.
The selected database stores accounts, login sessions, folders, saved
connections, credentials, SSH fingerprints, reusable SSH keys, and recent
connection timestamps.

SQLite resolves its file path against the process working directory, enables
foreign keys on every connection, and uses a five-second busy timeout. Its
connection pool allows four open and four idle connections. MySQL uses UTC
timestamp parsing, up to 25 open connections, ten idle connections, and a
three-minute connection lifetime. Application timestamps are written in UTC.

Switching `DATABASE_DRIVER` selects another database without copying data.
The desktop app always uses its own SQLite database. See
[configuration](configuration.md) for server settings and
[desktop data](desktop.md#data-and-backups) for native paths.

## Schema and relationships

| Table | Contents |
| --- | --- |
| `users` | Email, password hash, role, disabled flag, and creation time |
| `login_sessions` | Login token digest, owner, CSRF token, and expiry |
| `folders` | Owner, parent folder, name, and creation time |
| `connections` | Owner, folder, protocol/auth settings, encrypted remote and proxy secrets, host trust, VNC settings, SSH key reference, and timestamps |
| `ssh_keys` | Owner, name, encrypted private material, and creation time |
| `schema_migrations` | Applied schema versions |

Deleting a folder with child folders is restricted by a foreign key. Deleting
a folder containing connections clears their folder assignment, so they
return to Root. Services check ownership, prevent nesting cycles, and enforce
a depth limit of 16. Saved connections referencing reusable keys prevent
deletion of those keys.

Recent connection order uses `last_opened_at` in Unix microseconds. Recording
an open leaves the settings update timestamp unchanged.

## Migrations

Migrations live in [`internal/store/migrations`](../internal/store/migrations).
Each version implements `Up` and `Down`. Normal startup applies pending
versions. Explicit commands are:

```sh
go run ./cmd/lightremote migrate up
go run ./cmd/lightremote migrate down
```

`up` applies all pending versions and migrates legacy SSH keys. `down` rolls
back one version. Stop the server before rollback and take a backup first.
The command loads the regular server configuration, including
encryption-key settings, without starting the HTTP server. Migration up
resolves the same explicit or persistent generated key used during startup.

| Version | Addition | Rollback effect |
| --- | --- | --- |
| 1 | Users, login sessions, folders, and connections | Removes those tables and their data |
| 2 | Outbound proxy settings | Removes saved proxy settings |
| 3 | VNC display and access settings | Removes saved encoding, read-only, and file-transfer settings |
| 4 | Recent connection timestamp | Removes recent-open history |
| 5 | Reusable SSH keys and connection references | Refuses rollback while connections reference keys, otherwise removes the key table and reference column |

Version 3 is also run as a repair for already migrated databases to ensure
the expected VNC columns exist. Unknown applied versions cause startup or
migration failure.

SQLite migrations run in one immediate write transaction. MySQL uses a
database advisory lock to serialize migration commands. MySQL schema changes
follow the engine's DDL behavior rather than a single rollbackable transaction.

After schema migration, the SSH key service moves legacy inline private keys
into reusable entries in a separate transaction. Identical key material and
passphrases within the migration are shared only within the same owner.
Connections receive key references and lose their inline credential envelope.
Failure rolls back the key migration so startup can retry.

## Temporary state

| State | Lifetime and limit |
| --- | --- |
| SSH/VNC work sessions | In memory, up to 32 reservations per user |
| Viewer-free reservations | Expire after two minutes, including sessions created without a viewer |
| SSH output replay | Up to 1 MiB per shell |
| Direct connections | In memory, expire after 24 hours without a connection lookup |
| Connection metadata cache | Up to 512 entries, one-minute TTL, credentials removed |
| Login attempt counters | Bounded process-local map with a ten-minute attempt window |
| Browser file listings | Up to 100 user/connection/path entries in memory |

Restarting the backend loses live work sessions and temporary direct
connections. Saved database records remain available. Direct connections hold
encrypted credential envelopes and never enter the saved connection list.
The UI periodically looks up open direct connections to keep them available.
Closing a direct tab removes its connection and work sessions. Logout and
self-service password changes remove the owner's direct records.

Viewer handoff replaces the active attachment. SSH keeps its shell, while
frontend VNC detachment creates a new connection. Closing a tab releases the
session immediately. Full edits or deletion of saved connections close their
work sessions. Inline rename and folder moves preserve them.

Browser storage keeps sidebar ordering and appearance preferences. Detached
window coordination also uses session storage and BroadcastChannel messages.
These records contain tab metadata rather than saved remote credentials.
See [frontend](frontend.md#tabs-and-detached-windows).

## Backups

For server installations, keep a consistent database backup and the original
`ENCRYPTION_KEY` value or generated key file. Docker stores the generated key
at `/data/vault.key` alongside the database on the persistent volume. Outside
Docker, see [key-file defaults](configuration.md#server-settings).
Use a SQLite backup tool or copy the database while the app
is stopped. MySQL installations should use their normal database backup
procedure.

For desktop installations, keep both `lightremote.db` and `vault.key` in the
platform data directory. Losing the key prevents credential recovery, and
startup refuses to replace a missing key beside an existing database.
Live sessions, direct connections, and browser-only preferences are outside
the server database backup.
