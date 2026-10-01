# Frontend

The frontend is a React and TypeScript SPA built with Vite. It provides saved
connections, folders, remote viewers, file management, and account dialogs.
The same workspace runs in browsers and the Wails desktop app.

See [getting started](getting-started.md) for web setup and deployment, and
[desktop](desktop.md) for native builds.

## Application structure

[`main.tsx`](../frontend/src/main.tsx) installs the Redux store, Material UI
theme, bundled Roboto fonts, and application styles.
[`App.tsx`](../frontend/src/App.tsx) handles routing and authentication.

| Directory under `frontend/src` | Responsibility |
| --- | --- |
| `components/shell` | Header, menus, login, account dialogs, and connection opening |
| `components/sidebar` | Folder tree, drag and drop, connection forms, proxies, and host-key dialogs |
| `components/workspace` | Tabs, terminals, desktops, remote files, and status controls |
| `components/sshkeys` | Key management, import, and generation dialogs |
| `components/users` | Administrator account dialogs |
| `components/common` | Shared application feedback, icons, and action dialogs |
| `api` | RTK Query resources and direct file requests |
| `state` | Redux authentication, temporary tabs, and shared limits |
| `ui` | Shared Material UI wrappers, theme, and icons |
| `styles` | Shared tokens and feature styles |
| `desktop` | Native actions, title synchronization, and viewer transport adapter |
| `utils` | Paths, file sizes, shortcuts, zoom, and other shared helpers |

The main route renders a header, resizable sidebar, tabbed workspace, and
active-tab status bar. `/detached/:transferId` hosts a moved work tab.
Legacy login and settings URLs redirect to the main workspace.

## Authentication and data

At startup, `/api/auth/me` supplies the user, CSRF token, and local-mode flag.
Account login uses `/api/auth/login`. Authentication responses update Redux.
When no account exists and no initial admin password was configured, the
locked shell shows first-run installation. `/api/auth/setup` reports setup
status and accepts the administrator email and password. The form confirms
the password and signs in after successful installation. Existing accounts
show the normal login dialog, and private workspace content stays unmounted
until authentication succeeds. Local mode skips installation.
An expired or missing login shows a login dialog over the locked shell.
Server failures show a retry dialog.

[`api/base.ts`](../frontend/src/api/base.ts) uses relative `/api` URLs,
same-origin credentials, and `X-CSRF-Token`. RTK Query fetches and caches
folders, connections, recent connections, users, sessions, and SSH keys.
[`api/files.ts`](../frontend/src/api/files.ts) uses direct requests for file
operations and applies the same credentials and CSRF token.

The backend supplies each user's resources and enforces ownership. Account
menus offer password changes and administrator user management. Local mode
opens directly to the workspace and hides the Account menu.

Redux stores temporary workspace data. WebSocket, Wails stream, xterm.js, and
noVNC instances stay in component refs. Browser-facing types live in
[`types.ts`](../frontend/src/types.ts). See the
[API contract notes](architecture.md#api-contract) for specification gaps.

## Connections and folders

Folders use `parentId`, and connections use `folderId`. Root connections sit
beside top-level folders. Drag rows to reorder siblings or drop inside a
folder to change their parent. The browser saves sibling order per user.
Parent membership is saved by the backend, which rejects cycles and nesting
beyond 16 levels.

The sidebar add button offers a folder or connection. Adding inside a folder
preselects that folder. Folder names and connection labels can be renamed
inline. Renaming or moving a connection preserves its open viewer sessions.
Connection actions also support duplication and host-key review.

New connection forms start with a protocol choice: SSH, VNC, SFTP, or FTP/FTPS.
Selecting one opens the detail fields, and Back returns to the type choice.
Editing opens details directly. The folder picker contains Root and expandable
nested folders. Proxy fields support HTTP, HTTPS, and SOCKS5.

For an existing password connection, leaving the remote secret blank retains
it when the protocol and auth type stay the same. Private-key connections
retain their selected saved key. Retaining a proxy password requires unchanged
proxy type, host, port, and username. See [protocols](protocols.md#outbound-proxies).

File > Open connection, or Ctrl/Cmd+K, searches saved connections by name, host,
protocol, and username. File > New direct connection, or Ctrl/Cmd+Shift+K,
opens a temporary connection without adding it to the sidebar. Recent
connections track accepted opens of saved entries. Direct connections use
their host as the tab title and stay outside that list.

SSH and SFTP opening first inspects the host key. An unapproved or changed key
opens a dialog with the saved and observed fingerprints. Compare the observed
value with a trusted source before approval. Approval resumes opening, and
the backend re-inspects the fingerprint before storing it. Inspection errors
include the downstream connection or handshake reason.

File > SSH keys manages reusable keys. Connection forms can select a saved key
or import one. Imported keys remain saved when the connection dialog is
cancelled. The key manager also generates downloadable key pairs. See
[SSH keys](security.md#reusable-ssh-keys) for formats, limits, and storage rules.

## Tabs and detached windows

The workspace allows 32 open tabs, including detached tabs tracked by the main
window, and shows one active tab at a time. SFTP and FTP use file tabs without
backend work reservations. SSH and VNC reserve work sessions before attaching
their viewers.

Tabs can be reordered in the strip. The active tab fills the workspace and
supplies footer status and zoom. Other tabs keep their viewers mounted while
hidden so switching tabs preserves their sessions and state.

Detach moves the tab to a same-origin browser window or a native desktop
window. A per-user BroadcastChannel coordinates transfer and heartbeats.
Session storage keeps transfer records for recovery. SSH preserves its remote
shell and replays up to 1 MiB of recent output. VNC deletes its previous work
session and reconnects in the destination window.

Closing a detached window returns its tab to the main window. VNC reconnects
again there. Its file panel open state, width, and current path travel with
the tab. Closing a tab releases its work session or direct connection.
Workspace tabs are temporary across normal reloads. Detached transfer records
support limited recovery, and temporary direct tabs are discarded on reload.

Failed viewers show a connection error panel. Opening a failed SSH connection
again retries it. SSH ready and error states use text control messages. VNC
setup errors use transport close reasons.

## Terminals and desktops

SSH uses xterm.js with its fit addon. Auto terminal colors follow the app
appearance. View > Terminal theme also offers named palettes, including Ubuntu,
PowerShell Blue, Dracula, One Dark, Nord, Gruvbox Dark, and Solarized. Theme
changes update the renderer without reconnecting the shell.

Each SSH or VNC tab has its own zoom. SSH zoom changes the font size and
refits the PTY grid. VNC zoom changes the local viewport size, with scrolling
when the desktop exceeds its viewport. Desktop Ctrl+scroll changes zoom
using the same steps as the footer controls.

VNC uses noVNC against the backend's authenticated RFB bridge. The active
desktop exposes Ctrl+Alt+Del, Files, Cursor, and Screenshot actions. RichCursor
updates render the remote cursor locally. Cursor toggles a fallback dot for
servers that hide their pointer. Read-only mode disables desktop input in
both the frontend and backend.

The wheel pans an overflowing local viewport. Alt+wheel sends scrolling to
the remote desktop. The Files panel has a draggable divider and is available
for Full access and Read only with file transfer. A screenshot captures the
framebuffer at its native resolution, opens a preview, and offers PNG saving
or clipboard copying. Clipboard copying depends on browser support and
permission.

## Remote file manager

SFTP starts in the server-reported working directory. FTP starts at `/` in the
UI. The toolbar accepts absolute paths. Listings can be sorted by name, size,
or modification time, with alternating rows, formatted sizes through TB, and
icons for common file types.

The file client caches up to 100 user/connection/path listings in memory.
Cache hits refresh their position in the eviction order. Refresh fetches a
new listing, and file mutations invalidate affected paths. Navigation ignores
late responses for the previous directory.

Uploads accept the file picker or dropped files and send raw bodies. Browser
downloads use the native download path. Desktop downloads use a native save
dialog and report progress. Uploads and downloads show recent transfer speed
and estimated time remaining when the file size and throughput are known.
Renaming happens inline, while creation and deletion use application dialogs.
Deletion removes a file or empty directory.

Edit opens known text and configuration formats as UTF-8. Files must be smaller
than 10 MiB. The streamed reader enforces the same limit when the remote file
grows after listing. Save overwrites the file and refreshes the listing.
Ctrl/Cmd+S saves, and unsaved changes trigger a confirmation before leaving.

VNC `/` represents a virtual drive list. Opening `C:` uses `C:/`, and child
paths retain the drive prefix. Legacy `/C:` paths are normalized. The UI
disables rename and delete for drive roots. The drive list omits the Actions
column and fabricated modification dates. Narrow file panels scroll their
columns horizontally. Unsupported VNC file capabilities show an error.
SSH file requests require a separate SFTP connection.

## Appearance and status

Material UI supplies shared forms, dialogs, menus, buttons, and feedback.
View > Appearance selects system, light, or dark mode. Browser storage retains
appearance and terminal-theme preferences. Shared overrides belong in
[`ui/theme.ts`](../frontend/src/ui/theme.ts), while feature rules belong in
`styles`. Workspace colors use tokens in
[`styles/base.css`](../frontend/src/styles/base.css). Icons use Material
Symbols through the shared Glyph component. Roboto fonts are bundled locally.

The interface uses neutral surfaces, blue accents, and dense file rows.
Dialogs have header close buttons and headers and footers without divider
lines. The sidebar resizes between 200 and 480 px. Narrow screens use a
scrollable slide-in sidebar. Nested folders have branch connectors, and row
actions remain at the visible right edge during horizontal scrolling.
Rows stay highlighted while their action menu is open.

The status bar polls `GET /api/sessions/{sessionID}` for viewer byte counters
and last activity, then derives rates between samples. Separate file API
transfers are excluded from those viewer counters.
