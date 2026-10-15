# Advanced File Downloader

Node.js file portal with authenticated upload, download, multi-file ZIP download, search, and delete.

## Run locally

Requires Node.js 20 or newer. From this directory:

```sh
npm ci
npm start
```

Open `http://localhost:3000`. For local development only, the initial credentials are `Admin` / `Admin@123`. Set `ADMIN_PASSWORD` to a private value before exposing the app to a network. The first account is initialized in the SQLite database; retain the database volume to retain the account and uploaded data.

## Deploy with Docker

1. Copy `.env.example` to `.env` and set unique values for `ADMIN_PASSWORD` and `SESSION_SECRET` (at least 32 characters).
2. Build and run with a persistent `/data` volume:

```sh
docker build -t advanced-file-downloader .
docker run -d --name advanced-file-downloader --restart unless-stopped \
  --env-file .env -p 3000:3000 -v downloader-data:/data \
  advanced-file-downloader
```

Put the service behind an HTTPS reverse proxy for public hosting. The secure session cookie is enabled when `NODE_ENV=production`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port; hosting platforms commonly provide this. |
| `HOST` | `0.0.0.0` | Network interface to bind. |
| `DATA_DIR` | app directory | Base directory for persistent application data. |
| `DB_PATH` | `${DATA_DIR}/users.db` | SQLite database location. |
| `FILES_DIR` | `${DATA_DIR}/uploads` | The only directory exposed for file operations. |
| `ADMIN_USERNAME` | `Admin` | Initial administrator username. |
| `ADMIN_PASSWORD` | local dev: `Admin@123` | Initial administrator password. Production requires 12+ characters. |
| `SESSION_SECRET` | generated per process in development | Signs login sessions. Production requires 32+ characters. |
| `MAX_FILE_SIZE_MB` | `512` | Maximum size of an individual uploaded file. |

Use persistent storage for both the SQLite database and `FILES_DIR`. The former app allowed choosing arbitrary server paths in the browser; the repaired version intentionally uses the server-side `FILES_DIR` setting so users cannot browse or modify unrelated host files.

## Health check

`GET /health` returns `{"status":"ok"}` and can be used by a hosting platform's liveness probe.
