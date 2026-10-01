# Browser release bundle

GitHub Actions builds browser-mode downloads for macOS, Linux, and Windows,
in amd64 and arm64. Download `lightremote-browser-<platform>-<arch>.tar.gz`
for macOS or Linux, or `.zip` for Windows, from the GitHub release.

Each bundle contains the LightRemote server, the compiled browser frontend,
an example configuration, and these instructions. Go and Node.js are not
needed to run it.

## Start

Extract the entire bundle into a writable directory. Open a terminal in that
directory and copy `.env.example` to `.env` before starting the server.

On macOS or Linux:

```sh
cp .env.example .env
./lightremote
```

On Windows, use PowerShell:

```powershell
Copy-Item .env.example .env
.\lightremote.exe
```

Open `http://localhost:8080` and create the first administrator account.
The example configuration sets `FRONTEND_DIR=./frontend` so the server serves
the included frontend. Run the executable from the extracted directory so
the configuration and frontend paths resolve correctly.

## Configuration and data

Edit `.env` to change the listen address, database settings, or public origin.
When accessing the app through another hostname or a reverse proxy, set
`PUBLIC_ORIGIN` to the browser's origin, such as `https://remote.example.com`.

By default, the server stores `lightremote.db` and a generated `vault.key` in
the working directory. Back up both together. Keep this data when replacing
the executable and frontend with a newer release.
