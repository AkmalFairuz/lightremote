# Security

## Accounts and ownership

Account mode creates its first administrator through browser installation,
or optionally during startup when `ADMIN_PASSWORD` is configured. Blank
configuration never creates a blank-password account. Installation requires
an email and password before access to the workspace and is disabled once
any account exists, including disabled accounts. Roles are `admin` and `user`.
Account management routes require the admin role. Saved folders, connections,
reusable keys, direct connections, and work sessions are owner-scoped.

Passwords use salted Argon2id hashes with constant-time verification. The
minimum password length is six bytes. The stored format has fixed hash
parameters. Changes to those parameters need a compatible storage format.

The login limiter allows ten attempts per client address in ten minutes.
Its process-local address map is bounded at 4096 entries. The handler derives
the address from `RemoteAddr`, so a reverse proxy can cause clients to share
one limiter entry.

Installation requests have the same ten-attempt limit in a separate per-client
bucket. First-account creation is serialized with a SQLite write transaction
or a MySQL advisory lock; concurrent installation attempts cannot create a
second initial administrator. The setup POST requires a matching browser
Origin and JSON content type. Both setup endpoints are absent in local mode.

A password change revokes other login sessions, closes the user's work
sessions, and removes their direct connections. Logout revokes the current
login session and also closes the user's work sessions and direct connections.
An administrator disabling an account or resetting its password revokes login
sessions and closes its work sessions. Administrators cannot disable their
own account or remove their own admin role through the user-update route.

## Session tokens, CSRF, and origins

Login and installation return the user, `csrfToken`, `token`, and `expiresAt`.
The frontend stores only the token and expiry in `localStorage` under
`lightremote.auth`, then sends `Authorization: Bearer <token>` on API requests.
User details and CSRF tokens remain in memory. `/api/auth/me` validates the
stored credential after reload and returns the identity and CSRF token.
Authentication responses use `Cache-Control: no-store`.

The database stores a SHA-256 digest of the random session token. Sessions
expire according to `SESSION_TTL`; logout and account revocation invalidate
these same sessions. Authenticated mutations still require `X-CSRF-Token`.
Use HTTPS for account deployments. Tokens in localStorage are accessible to
application JavaScript, so injected scripts can read them. When browser storage
is unavailable, login lasts only for the current page. Login and logout changes
are synchronized across tabs.

Browser WebSockets offer `lightremote` and `lightremote.auth.<token>` in
`Sec-WebSocket-Protocol`; the server selects only `lightremote` and authenticates
before upgrading. Tokens are never placed in URLs. WebSocket requests require
an Origin. With `PUBLIC_ORIGIN` configured, it must match that value. Otherwise,
its host must match the request Host and use HTTP or HTTPS. Account viewer
attachments are bounded by their login session expiry.

Cookie authentication and `COOKIE_SECURE` configuration have been removed.
Existing users must sign in again after updating; old cookies are ignored.

## Local mode

Local mode uses a stable internal owner and a random CSRF token generated on
each process start. `/api/auth/me` supplies both without an account token.
Mutating requests still require that CSRF token.

The standalone local-mode server requires a loopback listening IP. HTTP
requests must use a loopback or `localhost` Host. Supplied HTTP Origins and
WebSocket Origins must match the local request host. Login, logout, password,
and user-management routes are absent. Keep this mode on the local machine.

Desktop API requests carry an internal context marker supplied by the Wails
entry point. This permits native asset-server requests without browser
loopback-host checks. The shared CSRF requirement remains in place. Native
viewer streams attach only to the local owner's sessions.

## Credential encryption

[`internal/security/crypto.go`](../internal/security/crypto.go) implements an
AES-256-GCM vault. A supplied `ENCRYPTION_KEY` must decode to 32 bytes. When
omitted, the server warns in its log and uses a persistent randomly generated
key file. See [key configuration](configuration.md#server-settings).
Each encrypted envelope includes a format version and random nonce.
Associated data binds
remote credentials to the connection ID and proxy passwords to a separate
`connectionID:proxy` context. Reusable key envelopes bind to their key ID.

Saved passwords, private keys, and passphrases are encrypted at rest. Direct
connections also hold encrypted credential envelopes in memory. Metadata API
responses omit credential material. Generated key pairs are intentionally
returned to their requesting owner for download before optional storage.

Changing or losing the vault key makes existing encrypted credentials
unreadable. Back up the database with the original environment key or generated
key file. The server refuses to generate a replacement for a missing file
when encrypted credentials already exist. Desktop apps keep their key in
`vault.key`, separate from the server environment. See
[backups](storage.md#backups).

## SSH host trust

SSH and SFTP require a pinned SHA-256 fingerprint. Inspection reads the key
without trusting it or authenticating to the server. Compare it against a
trusted source before approving that exact fingerprint.

The approval handler re-inspects the server key and rejects a different
observed value. Later connections check against the saved fingerprint.
Missing trust returns `host_key_unapproved`, and changed trust returns
`host_key_changed`. File routes report these errors with HTTP 409.
Changing a saved connection's host or port clears its approved fingerprint.

## Reusable SSH keys

Each user can import PEM or OpenSSH private keys up to 512 KiB, with an optional
passphrase. The service validates the key before encrypting and saving it.
The UI reads imported files as UTF-8. Listing keys returns metadata, with
private material excluded.

Saved SSH and SFTP connections can reference an owned key through `sshKeyId`.
A key referenced by a saved connection cannot be deleted. Direct connections
copy its encrypted credentials into their temporary connection record.
Legacy connection keys are migrated into reusable records during startup.

Generation supports Ed25519, ECDSA P-256, and RSA 4096. It returns a private
key and an authorized-key public line without saving either one. An optional
passphrase protects the downloaded private key. Store key explicitly saves
the private material in the encrypted vault.

See [`internal/sshkeys`](../internal/sshkeys) for implementation and
[frontend](frontend.md#connections-and-folders) for the user workflow.

## Outbound address checks

[`DialTCP`](../internal/remote/dial.go) resolves the endpoint and rejects
loopback, link-local, unspecified, and multicast addresses. Private network
addresses remain allowed. The dialer opens the checked numeric address and
tries permitted results within the configured timeout.

Direct network connections apply this policy to the remote endpoint. Proxied
connections apply it to the proxy endpoint, with target name resolution left
to the proxy. Proxied targets can be private or loopback hosts. TLS verifies
HTTPS proxy and FTPS certificates. See [proxy behavior](protocols.md#outbound-proxies).
