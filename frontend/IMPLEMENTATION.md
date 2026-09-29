# Frontend architecture

LightRemote's frontend is a React and TypeScript single-page app built with
Vite. It provides an authenticated workspace for saved connections, remote
sessions, and file management. See [README.md](README.md) for local development
and deployment instructions.

## Application structure

`src/main.tsx` installs the Redux store, Material UI theme, and application
styles. `src/App.tsx` handles routing and the initial authentication check. The
main route renders a shell with a header, a folder and connection sidebar, a
tabbed workspace, and status controls. A separate route hosts detached work
tabs.

- `src/components/shell/` owns the application frame, navigation, and account
  dialogs.
- `src/components/sidebar/` owns the folder tree and connection management
  forms.
- `src/components/workspace/` owns tabs, panes, terminals, remote desktops,
  file management, and status controls.
- `src/components/users/` and `src/components/common/` contain focused dialogs
  and reusable application components.
- `src/ui/` contains shared Material UI wrappers and the theme; `src/styles/`
  contains styles for the shell and individual features.

## State and backend data

`src/state/` holds authentication and temporary workspace state in Redux.
Redux Toolkit Query in `src/api/` fetches and caches backend resources. The
file client in `src/api/files.ts` uses direct browser requests for uploads,
downloads, and other file operations. Long-lived WebSocket, xterm.js, and
noVNC instances stay with their components rather than in Redux.

The app obtains the current user and CSRF token from `/api/auth/me`. API calls
use same-origin credentials, and state-changing requests include the CSRF
token. The backend enforces access control and supplies the resources visible
to the current user. `src/types.ts` defines browser-facing data shapes; the
backend contract is documented in [the OpenAPI specification](../api/openapi.json).

## Remote work

The sidebar opens connections in workspace tabs. SSH and VNC use backend work
sessions and WebSockets: xterm.js renders terminals, while noVNC renders remote
desktops. SFTP, FTP, and supported VNC file transfer use the file manager.
The workspace manages pane layout, tab focus, session lifecycle, and detached
windows. Protocol-specific behavior belongs in the corresponding workspace
components and API modules.

## Visual conventions

Material UI provides common controls and light and dark themes. Shared theme
values and component overrides live in `src/ui/theme.ts`; feature styles live
in `src/styles/`. Use the shared UI components and theme rules for behavior
that should be consistent across dialogs or menus. The app uses Iconify
Material Symbols and bundled Roboto fonts.

## Detailed implementation notes

### Layout and visual system

The app uses four regions: a narrow title and account header, a
resizable folder sidebar, a working area with up to four visible panes, and a status strip for the
focused tab. At narrow widths the sidebar becomes an independently scrollable slide-in panel. Keep the
neutral surfaces, blue accents, and dense file-manager rows. The controls in `src/ui/` wrap
Material UI, with shared theme values in `src/ui/theme.ts`. Dialog headers
and footers follow Material UI spacing without divider lines. Dialogs close
from the icon button in their header.
The navbar View menu switches between light and dark modes; MUI stores the
choice in this browser. Custom workspace colors use tokens in
`src/styles/base.css`.
Use Iconify Material Symbols for icons and the locally bundled Fontsource
Roboto font. Add CSS to the relevant file in
`src/styles/` instead of growing a single global stylesheet.

### Code organization

- `src/api/` contains the same-origin REST client. Redux Toolkit Query caches
  accounts, folders, connections, and sessions. `files.ts` handles streaming
  file request bodies and direct browser downloads.
- `src/state/` contains the Redux store, authentication state, and temporary
  workspace tabs. WebSocket, xterm.js, and noVNC instances stay in component
  refs because they are not serializable application state.
- `src/components/sidebar/` contains the folder tree and connection, folder,
  proxy, and host-key forms. `src/components/workspace/` contains tabs, SSH,
  VNC, files, and status. `src/components/shell/` contains the navbar menus,
  account dialogs, and the login dialog.
- `src/ui/` contains the Material UI theme and the shared buttons, fields,
  dialogs, menus, and feedback controls. `src/types.ts` mirrors the browser-facing shapes in
  `../api/openapi.json`.

### Authentication and API calls

At startup `/api/auth/me` supplies the current user and CSRF token. Login uses
`/api/auth/login`; both responses update the Redux authentication slice. The
API client includes the `lr_session` cookie through same-origin requests and
sends `X-CSRF-Token` on state-changing requests. File mutations use the same
token. Without a valid account session, the main layout remains visible behind
a login dialog. Local mode obtains its identity from `/api/auth/me` without a
login session or Account menu.

The backend owns access control. The UI only receives the current user's
folders and connections. The navbar account menu opens a password dialog.
Administrators can manage users and edit their email addresses in a dialog
from the same menu. Password changes revoke other login sessions and close
the current user's work sessions.

### Connection workflow

Folders are nested through `parentId`; connections without a folder appear
directly at the root beside top-level folders. Drag rows to reorder them or
drop on a folder's center to move them inside it. Sibling order is stored in
this browser for each user; folder membership is saved by the backend. The
sidebar add button asks whether to create a folder or a connection. The same
choice appears when adding inside a folder. New connections from that action
start inside the selected folder. Folder names are edited inline, and folder
parents change through drag and drop.
Folder and connection rows stay highlighted while their action menus are open.
The sidebar scrolls in both directions when its content needs the space, and
its divider resizes it from 200 to 480 px. Nested folders have branch
connectors. Row actions stay at the visible right edge during horizontal
scrolling and do not reserve width while hidden. Connection
forms cover SSH, VNC, SFTP, FTP, explicit FTPS, and HTTP/HTTPS/SOCKS5 downstream
proxies. Saved passwords and private keys never come back from the API. On
new connections, the dialog first asks only for SSH, VNC, SFTP, or FTP/FTPS;
selecting a type opens the detail fields and Back returns to the protocol choices.
The folder field opens a nested picker with Root and expandable folder rows.
Editing an existing connection opens its details directly. On
edit, leave a remote secret blank to retain it when the protocol and auth type
are unchanged. A proxy password can only be retained when its type, host,
port, and username stay unchanged. The connection menu also renames a row
inline without closing its open SSH or VNC tabs.
For SSH and SFTP private key authentication, select a saved SSH key or add one
from the connection form. File → SSH keys manages the account's reusable keys.
Adding a key accepts a UTF-8 PEM or OpenSSH file (up to 512 KiB) and an optional
passphrase; it remains saved even if the connection form is cancelled. Existing
connection keys are migrated into reusable entries. Key material is encrypted
in the database and is not returned by key listing or lookup. A key in use by
a saved connection cannot be deleted. Password and passphrase fields share a
visibility toggle.
The SSH keys dialog can also generate Ed25519, ECDSA P-256, or RSA 4096 key
pairs in Go. Generation does not save the key. The user can download the private
and public keys, then choose Store key to save the private key encrypted in the
database. An optional passphrase protects the downloaded private key.

SSH and SFTP hosts require a pinned fingerprint. The connection menu opens
the host-key dialog: inspect the observed fingerprint, compare it with a
trusted source, then approve that exact value. A changed key must be reviewed
again. The backend returns errors in `{ "error": { "code", "message" } }`.

### Work tabs and remote files

SSH and VNC open by reserving a session with
`POST /api/connections/{connectionID}/sessions`, then connecting to
`/api/sessions/{sessionID}/ws`. The browser cookie authenticates the WebSocket;
the backend checks its Origin. The UI allows 32 tabs and up to four visible,
resizable panes. Drag a tab onto a pane edge to split it or its center to show
it there; the focused pane controls footer status and zoom. Tabs can be reordered
in the strip. Detach moves a tab into a same-origin window. SSH keeps its
remote shell and replays up to 1 MiB of recent output. VNC closes the old work
session and creates a fresh remote connection in the detached window. A closed
detached window returns its tab to the original window; VNC reconnects there.
Closing the tab deletes
the work session. Session tabs are temporary across reloads.
The SSH terminal switches between light and dark color palettes with the
application theme without reconnecting its WebSocket.
The footer zoom controls keep a separate level for each SSH or VNC tab.
SSH zoom changes xterm's font size and refits its grid; VNC zoom changes the
local noVNC viewport size and scrolls when it grows beyond the visible pane.

SSH uses xterm.js. Browser terminal input is binary UTF-8, server output is
binary terminal data, and terminal resize is a JSON text WebSocket message.
SSH session creation and WebSocket errors appear in the connection error panel. Opening a
failed SSH connection again retries the session.
Host-key inspection failures also include the downstream dial or handshake
reason in that error panel.
VNC connection setup failures arrive as WebSocket close reasons and appear in
the failed tab, while SSH uses text control messages for ready and error states.
Opening SSH or SFTP first inspects the current server host key. An unapproved
or changed fingerprint opens a confirmation dialog showing both the saved
fingerprint (if any) and the current one. Approving it resumes the connection;
the backend re-inspects the key before saving the approval.
VNC uses noVNC against the backend's standard RFB stream; the backend handles
upstream credentials. The focused VNC tab shows Ctrl+Alt+Del, Files, and Cursor
actions in the status bar. The backend forwards RichCursor updates for local
pointer rendering; Cursor toggles a fallback dot when the server hides it.
Read-only VNC connections disable desktop input in noVNC and at the backend.
The Files panel is available only for Full access and Read only with file transfer.
The VNC file panel has a draggable divider, and the
desktop viewport scrolls when zoom makes it larger than the available space.
The file panel's open state, width, and current directory travel with a VNC tab
when it is detached or returned to the main window.
The wheel pans an overflowing local viewport; Alt plus wheel sends scrolling
to the remote desktop instead.
VNC's `/` is a virtual drive list. Opening `C:` uses `C:/`, and paths
within that drive keep the `C:/` prefix. Drive roots cannot be renamed or
deleted. Older `/C:` paths are normalized when opened; the virtual drive list
does not show an Actions column or a fabricated modification date.
File actions remain within their own grid column and scroll horizontally when
the file panel is narrow.

SFTP and FTP connections open the file manager directly. SFTP starts at the
working directory reported by the server rather than `/`. Enter an absolute
path in the toolbar to navigate elsewhere. Entries can be sorted by name,
size, or modified time and use alternating row colors. Directory results are
cached in memory for up to 100 user/connection/path combinations; Refresh
bypasses the cache, and file changes invalidate affected paths. File sizes
include GB and TB. Iconify Material Symbols distinguish documents, data,
images, audio, video, archives, code, and other common file types. Renaming happens in
the entry row; creation and deletion use in-app dialogs. Files can be uploaded
with the picker or by dropping them onto the file manager. The file manager
uploads raw file bodies and downloads through the browser's native download
path. The Edit action opens known text and configuration file types in a UTF-8
editor. Files of 10 MiB or more cannot be edited; the reader also enforces this
limit while streaming in case the remote file changed after listing. Save
overwrites the remote file and refreshes its directory listing. Ctrl/Cmd+S
saves, and leaving with unsaved changes opens an in-app confirmation. Deletes
are not recursive. The backend rejects SSH file operations; save an SFTP connection
for those files. Show a capability error when a VNC server does not support
TightVNC or UltraVNC file transfer.

### Status and limitations

`GET /api/sessions/{sessionID}` reports WebSocket bytes sent and received plus
last activity. The status bar polls the selected work tab and derives rates
from successive counter samples. These counters do not include separate file
API transfers.

The Go backend does not serve the SPA itself. In production, host static files
and proxy `/api` on the same public origin. See `README.md` for the local Vite
proxy and deployment requirements.
