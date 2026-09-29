# LightRemote frontend

The browser client for the LightRemote Go backend. It provides saved connection
and folder management, up to 32 tabs with four visible panes, SSH terminals,
VNC desktops, remote file operations, and account management dialogs opened
from the navbar. Forms, dialogs, menus, buttons, and feedback use Material UI.
In the desktop app, Ctrl+scroll over an SSH terminal or VNC desktop changes
that tab's zoom in the same steps as the status bar controls.

## Run locally

Start the backend from the repository root with a configured `.env`:

```sh
go run ./cmd/lightremote
```

For local HTTP development, set `COOKIE_SECURE=false`. If `PUBLIC_ORIGIN` is
configured, set it to the Vite origin, normally `http://localhost:5173`.

Then run the frontend:

```sh
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/healthz` to `http://127.0.0.1:8080`, including the
session WebSocket route. Browser requests remain on the same origin, so the
backend's cookie and CSRF rules work without a CORS configuration. With
`LOCAL_MODE=true`, use `LISTEN_ADDR=127.0.0.1:8080`; the workspace opens
without a sign-in dialog or Account menu.

## Checks

```sh
npm run format:check
npm run build
npm run lint
```

Run `npm run format` after edits. The production build minifies its JavaScript.

## Deployment

Serve `dist/` with an SPA fallback to `index.html`. Route `/api` and `/healthz`
to the Go backend on the same public origin and allow WebSocket upgrades under
`/api/sessions/*/ws`. Use HTTPS and set `PUBLIC_ORIGIN` to the browser origin.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the component structure,
backend flows, and known API boundaries.
