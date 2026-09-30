# Desktop app

The Wails v3 desktop app runs the React workspace and shared Go services in
local mode. It needs no separate HTTP server or login. API requests use the
Wails asset server, and SSH/VNC viewers use native streams.

## Build

Use Go 1.26, Node.js 22, and the platform dependencies required by Wails.
The repository pins the Wails CLI, Go module, and frontend runtime to
`v3.0.0-beta.26`.

- macOS builds need the native compiler toolchain. Build tasks set macOS 12 as
  the deployment target.
- Linux builds need a native compiler, `pkg-config`, GTK 4, and WebKitGTK 6.
  CI installs `build-essential`, `pkg-config`, `libgtk-4-dev`, and
  `libwebkitgtk-6.0-dev` on Ubuntu.
- Windows apps need the WebView2 Runtime. The Windows build task disables CGO.

The [Wails installation guide](https://v3.wails.io/getting-started/installation/)
provides platform setup instructions.

Run at the repository root:

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.26
cd frontend
npm ci
cd ..
wails3 build
```

The root and platform Taskfiles build the frontend with `VITE_DESKTOP=true`,
generate platform icons, and compile the native executable. Output is
`bin/lightremote-desktop`, or `bin/lightremote-desktop.exe` on Windows.
The entry point embeds `frontend/dist`.

Start desktop development with:

```sh
wails3 dev
```

The development config watches Go sources, runs the frontend development
server, and starts the native app. Its default Vite port is 9245. On macOS,
the development run task wraps the executable in a local app bundle and
ad-hoc signs it.

## API and native integration

The desktop entry point calls the shared bootstrap with desktop-owned
configuration. Asset middleware sends `/api/*` and `/healthz` requests to
the common router and marks them as in-process desktop requests. SPA routes
such as `/detached/*` resolve to the bundled index page.

The frontend imports the Wails runtime only in desktop builds. Native services
provide detached windows, remote file saving, generated-key saving, screenshot
saving, and recent-connection menu updates. A second application launch
restores and focuses the existing main window.

Windows uses in-app title-bar controls. macOS uses the hidden native title-bar
style and installs a native menu with connection actions and recent entries.
Native window titles follow the React page title, including detached windows.

Remote downloads open a native save dialog and emit progress events. Key and
PNG saving also use native dialogs. Writes go to a temporary file beside the
chosen destination, then sync, close, and rename after success.

## Viewer transport

[`viewerSocket.ts`](../frontend/src/desktop/viewerSocket.ts) provides a shared
viewer interface for browser WebSockets and Wails sockets.
[`internal/desktop/stream.go`](../internal/desktop/stream.go) adapts native
streams to the backend `ViewerTransport` interface.

The app registers `ssh` and `vnc` streams. The first message is a JSON hello
containing `sessionId`, limited to 1024 bytes. Later messages carry a one-byte
prefix followed by the payload:

| Prefix | Payload |
| --- | --- |
| `0` | Binary terminal or RFB data |
| `1` | Text control data |
| `2` | Backend close reason |

The adapter acknowledges attachment and resolves the session against the local
owner. Shared viewer code handles SSH controls and VNC forwarding. Native
streams avoid browser WebSocket upgrades while preserving protocol behavior.

## Data and backups

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/LightRemote` |
| Windows | `%LOCALAPPDATA%\LightRemote` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/lightremote` |

The directory contains `lightremote.db`, `vault.key`, and `lightremote.log`.
Data is separate from the web server's database. Desktop startup bypasses the
server environment loader, so `.env` settings do not apply.

The app creates a random 32-byte vault key on first use. Keep the database and
key together in backups. Startup rejects an invalid key and refuses to create
a new key beside an existing database. On macOS and Linux, the data directory
uses mode 0700 and the key uses mode 0600. An existing key readable by other
users is rejected.

## CI artifacts and troubleshooting

The [desktop workflow](../.github/workflows/desktop-build.yml) builds amd64 and
arm64 on native macOS, Windows, and Linux runners. It runs on pull requests
and pushes to `feature/wails`. Each job uploads a `.tar.gz` containing the
compiled executable, with a 14-day retention period.

Extract the archive before launching the executable, including on Windows.
The artifacts contain compiled executables rather than platform installers.

Startup logging goes to `lightremote.log` in the platform data directory.
Windows also displays a startup-error dialog. For startup failures, read the
log and check the vault key, database access, and native WebView dependencies.
Windows needs WebView2. Restore the original vault key when startup reports a
missing key beside existing data.
