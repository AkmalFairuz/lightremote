# LightRemote documentation

LightRemote runs as a web workspace backed by a Go server or as a Wails desktop
app. Both use the same React interface and backend services.

| Guide | Contents |
| --- | --- |
| [Getting started](getting-started.md) | Run the web workspace, choose an operating mode, and deploy it |
| [Configuration](configuration.md) | Environment variables, defaults, and validation |
| [Architecture](architecture.md) | Entry points, backend layers, API flows, and state ownership |
| [Frontend](frontend.md) | Components, connections, tabs, detached windows, and files |
| [Protocols](protocols.md) | SSH, VNC, file transfers, and outbound proxies |
| [Security](security.md) | Accounts, session cookies, CSRF, credentials, and host trust |
| [Storage](storage.md) | Databases, migrations, backups, and temporary state |
| [Desktop](desktop.md) | Native builds, streams, platform integration, and troubleshooting |
| [Development](development.md) | Repository layout and verification commands |

The [OpenAPI specification](../api/openapi.json) describes the HTTP API.
[Architecture](architecture.md#api-contract) records gaps between that file and
the current router.
