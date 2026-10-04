# Docker deployment

The [Dockerfile](../Dockerfile) packages the browser frontend and standalone Go
server in one image. It serves the workspace, API, health check, and WebSockets
on port 8080. Images support Linux amd64 and arm64 and run as UID/GID 10001.

## Run a published image

No environment variables are required for the default local HTTP installation.
The [Compose file](../docker-compose.yaml) comments out settings already supplied
by the image or server. Uncomment `environment:` and the settings you want
to override.

Prepare the local data directory. On Linux, give the container's UID/GID 10001
write access before starting it:

```sh
mkdir -p data
sudo chown 10001:10001 data
sudo chmod 700 data
```

Run:

```sh
docker compose pull
docker compose up -d
```

Open `http://localhost:8080` and complete the first-run installation screen.
Enter your administrator email and a password of at least six characters,
then confirm the password. Installation signs you in and cannot be repeated
after an account exists. Existing installations show the normal login screen.
Database and encryption settings use automatic defaults.

Compose defaults to
`ghcr.io/akmalfairuz/lightremote:latest`, which becomes available after the
first stable GitHub release is published. If the GHCR package is private,
authenticate with `docker login ghcr.io` using a personal access token (classic)
with `read:packages`, or make the package public in its GitHub settings. See
[GitHub's registry authentication documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

The Compose service uses account mode and mounts the local `./data` directory
at `/data`. SQLite lives at `./data/lightremote.db`, and the generated encryption
key lives at `./data/vault.key`. Restarting or replacing the container and
`docker compose down --volumes` preserve this directory. Back up its database
and key together. When switching an existing deployment from the named volume,
copy its database and key into `./data` before starting the updated service.
The image health check calls `/healthz`, which checks database connectivity.

When `ENCRYPTION_KEY` is not specified, the server logs a warning and creates
a random key at `/data/vault.key`, with owner-only permissions. Restarts reuse
this file. If it is missing while encrypted credentials exist, startup fails
and requests the original key instead of generating a replacement.

To supply your own key, uncomment `environment:` and `ENCRYPTION_KEY` in
Compose and set the key directly in that file. It must be a base64-encoded
32-byte key; `openssl rand -base64 32` generates one for a fresh installation. Existing deployments that previously
used `ENCRYPTION_KEY` must uncomment that setting and keep their original value.
An explicit key takes precedence over the file and is not rotated automatically.

## Select an image or public address

Edit the literal values in `docker-compose.yaml` to change the image or address:

| Setting | Default | Purpose |
| --- | --- | --- |
| `image` | `ghcr.io/akmalfairuz/lightremote:latest` | Published release tag or locally built image |
| `ports` | `8080:8080` | Host HTTP port on all interfaces; the container listens on 8080 |

For a particular release, set `image` to its image tag, such as
`ghcr.io/akmalfairuz/lightremote:v1.2.3`, then pull and recreate the service.
Prereleases have their own version tag and do not update `latest`.

The published port binds to all host interfaces. For remote access, put HTTPS
at a reverse proxy, preserve the request Host, and allow WebSocket upgrades.
Uncomment `environment:` and `PUBLIC_ORIGIN`, then set the exact browser origin
as its value. Without it, the server compares browser origins with the request
Host. Complete initial installation before exposing a new instance publicly.

Compose inherits the image's frontend path, SQLite path, account mode,
internal port, and generated-key path. To override a commented setting,
uncomment `environment:` and its line, then edit the literal value. The server's
remaining configurable settings are listed in [configuration](configuration.md). Using the image directly also
allows the server's existing MySQL configuration; Compose does not add MySQL.

You can optionally uncomment `ADMIN_EMAIL` and `ADMIN_PASSWORD` to provision
the first administrator without the browser installer. A blank password leaves
installation pending; it never creates an account with a blank password.
The default email for environment-based bootstrap is `admin@localhost`.

## Build locally

To use the Dockerfile before a release is available:

```sh
docker build -t lightremote:local .
```

Set `image: lightremote:local` in `docker-compose.yaml`, then run:

```sh
docker compose up -d
```

The build installs frontend dependencies from the lockfile, creates a browser
production build, and cross-compiles `./cmd/lightremote` with CGO disabled.
The runtime contains the server, frontend assets, and CA certificates; it
contains no Node.js or Go toolchain. `.dockerignore` excludes local credentials,
environment files, databases, dependencies, and generated artifacts.

The image sets `FRONTEND_DIR=/app/frontend`. For a standalone server outside
Docker, set `FRONTEND_DIR` to the built frontend directory to serve the UI on
the API origin. Leave it unset to retain API-only operation.

## GitHub Actions publishing

[The Docker workflow](../.github/workflows/docker-build.yml) builds both Linux
platforms on pull requests and pushes to `master`, without logging into GHCR
or publishing images. An automatic `[release] vX.Y.Z` commit release calls the
Docker publishing workflow after the downloads are published. Publishing a
GitHub release manually also builds the release's commit
and pushes to `ghcr.io/<lowercase-owner>/<lowercase-repository>` using
`GITHUB_TOKEN` and release-job-only `packages: write` permission.

Each published release gets a Docker-safe tag derived from its GitHub release
tag. Stable releases also update `latest`; prereleases only publish their
version tag. Draft releases and ordinary Git tag pushes do not publish images.
The Dockerfile and workflow contain no test steps.
