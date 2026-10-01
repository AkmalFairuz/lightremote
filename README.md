# LightRemote

[![Desktop build](https://github.com/AkmalFairuz/lightremote/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/AkmalFairuz/lightremote/actions/workflows/desktop-build.yml)
[![Docker image](https://github.com/AkmalFairuz/lightremote/actions/workflows/docker-build.yml/badge.svg)](https://github.com/AkmalFairuz/lightremote/actions/workflows/docker-build.yml)

LightRemote brings SSH terminals, VNC desktops, and SFTP, FTP, and explicit FTPS
file management into one browser and desktop workspace, with TightVNC and
UltraVNC file transfer support. Work across tabbed
sessions and detachable windows, organize saved connections, manage reusable
SSH keys, and connect through HTTP, HTTPS, or SOCKS5 proxies. Saved credentials
are encrypted at rest. Built with Go and React. See the [documentation](docs/index.md).

<p align="center">
  <a href="docs/images/screenshot-vnc-desktop.png"><img src="docs/images/screenshot-vnc-desktop.png" width="800" alt="LightRemote viewing a remote Ubuntu desktop over VNC" /></a>
</p>

# Get Started

## Web browser

**Install with Docker:**

```sh
docker run -d \
  --name lightremote \
  --restart unless-stopped \
  -p 8080:8080 \
  -v lightremote-data:/data \
  ghcr.io/akmalfairuz/lightremote:latest
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) and create the first admin
account.

## Desktop

Download the latest release for your OS and architecture:

[![macOS Intel](https://img.shields.io/badge/Download-macOS%20Intel-blue?logo=apple)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-macos-amd64.dmg)
[![macOS Apple Silicon](https://img.shields.io/badge/Download-macOS%20Apple%20Silicon-blue?logo=apple)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-macos-arm64.dmg)
[![Windows x64](https://img.shields.io/badge/Download-Windows%20x64-0078D4?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTIgNC41IDEwLjUgMy4zdjhIMnptOS44LTEuMzVMMjIgMS43NXY5LjU1SDExLjh6TTIgMTIuNWg4LjV2OEwyIDE5LjN6bTkuOCAwSDIydjkuNTVsLTEwLjItMS40eiIvPjwvc3ZnPg==)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-windows-amd64.tar.gz)
[![Windows ARM64](https://img.shields.io/badge/Download-Windows%20ARM64-0078D4?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTIgNC41IDEwLjUgMy4zdjhIMnptOS44LTEuMzVMMjIgMS43NXY5LjU1SDExLjh6TTIgMTIuNWg4LjV2OEwyIDE5LjN6bTkuOCAwSDIydjkuNTVsLTEwLjItMS40eiIvPjwvc3ZnPg==)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-windows-arm64.tar.gz)
[![Linux x64](https://img.shields.io/badge/Download-Linux%20x64-blue?logo=linux)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-linux-amd64.tar.gz)
[![Linux ARM64](https://img.shields.io/badge/Download-Linux%20ARM64-blue?logo=linux)](https://github.com/AkmalFairuz/lightremote/releases/latest/download/lightremote-linux-arm64.tar.gz)

# Features

- **SSH terminals:** Password and private key authentication, zoom, and shell
  continuity when moving between windows.
- **VNC desktops:** Remote keyboard and mouse control, read-only modes,
  screenshots, cursor controls, and per-tab zoom.
- **Remote file management:** Browse, upload, download, rename, and edit files
  over SFTP, FTP, and explicit FTPS, with drag-and-drop uploads and transfer progress.
- **VNC file transfer:** Integrated TightVNC and UltraVNC file browsing and transfers.
- **Flexible workspace:** Reorder tabs, detach them into separate windows,
  and resize the sidebar and VNC file panel.
- **Connection folders:** Organize connections in nested folders, rename them
  inline, and drag and drop to reorder or move entries.
- **Connection management:** Search connections with keyboard shortcuts,
  reopen recent connections, duplicate saved entries, and open temporary direct connections.
- **Appearance:** Light, dark, and system themes, plus terminal color palettes
  with saved appearance preferences.
- **Live status:** Connection status, traffic counters, and transfer speeds
  in the workspace status bar.
- **SSH key management:** Import, generate, and reuse keys across connections.
- **Proxy support:** Connect through HTTP, HTTPS, and SOCKS5 proxies.
- **Credential protection:** Encrypt saved credentials at rest and verify SSH
  host fingerprints before connecting.
- **Browser and desktop:** Self-host with Docker or run locally on macOS,
  Windows, and Linux, with amd64 and arm64 builds.
- **Accounts and storage:** Admin and user roles, account-owned connections,
  SQLite or MySQL server storage, and local SQLite storage for desktop use.
