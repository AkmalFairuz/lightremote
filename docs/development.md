# Development

See [getting started](getting-started.md) for web development and
[desktop](desktop.md#build) for Wails development.

## Repository layout

| Path | Contents |
| --- | --- |
| `cmd/lightremote` | Standalone server and migration command |
| `main.go`, `main_windows.go`, `main_other.go`, `desktop_menu.go` | Desktop entry point and native platform integration |
| `internal` | Shared backend packages and Go tests |
| `frontend/src` | React workspace, resource clients, styles, and native adapter |
| `api/openapi.json` | HTTP API specification |
| `Taskfile.yml`, `build` | Wails tasks, platform build settings, icons, and application metadata |
| `.github/workflows/desktop-build.yml` | Native desktop build matrix |
| `.env.example` | Standalone server configuration example |
| `docs` | Setup and implementation documentation |

[Architecture](architecture.md) explains backend responsibilities.
[Frontend](frontend.md) describes component and state organization.
[Protocols](protocols.md) covers the remote adapters.

## Checks

At the repository root:

```sh
go test ./cmd/lightremote ./internal/...
go vet ./cmd/lightremote ./internal/...
```

These targets cover the standalone entry point and shared backend. They omit
the root desktop package, which needs frontend build assets and native platform
libraries. Use `wails3 build` to check the desktop target.

For frontend changes:

```sh
cd frontend
npm run format:check
npm run build
npm run lint
```

`npm run build` checks TypeScript and creates a minified Vite production build.
`npm run format` applies Prettier to the frontend. The package has no dedicated
frontend test script.

## Existing coverage

Go tests cover concrete behavior in these areas:

- SQLite repositories, schema migration, and rollback.
- Local-mode configuration, stable ownership, removed account routes, and CSRF.
- Vault record binding, separate proxy encryption, and password verification.
- Folder depth, proxy-password retention, connection duplication, and managed
  keys for saved and direct connections.
- Reusable key migration, deletion constraints, and generated key pairs.
- Per-user work-session limits, VNC close reasons, and file error details.
- HTTP, HTTPS, and SOCKS5 proxy fixtures, failure without direct fallback, and
  FTP control and passive data connections.
- Windows drive paths, VNC framebuffer framing, encoding preferences,
  RichCursor forwarding, and TightVNC file lists alongside display updates.

The checked-in database integration suite uses SQLite. Protocol tests use
fixtures rather than a complete matrix of real remote servers. Native build
success and frontend checks do not establish visual correctness. The user
runs the app and verifies UI changes under the project workflow.

## Documentation maintenance

Keep both READMEs to a title and one description paragraph. Put setup and
implementation details in the focused pages linked by [the index](index.md).
Update documentation against the relevant code and link to its source.

Check configuration defaults, routes, schema versions, limits, build tasks,
and relative links when those areas change. The router currently includes
SSH-key and recent-connection routes missing from OpenAPI. See
[API contract notes](architecture.md#api-contract).

Project agent instructions live in [AGENTS.md](../AGENTS.md). Shared menu
styles belong in the theme or shared component rules. Review applied MUI
styles and interaction states when diagnosing layout problems. Keep Go
function signatures on one line, and add tests for concrete regression risks.
