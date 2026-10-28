# Installation

Prompt Notebook is an independent application. You do not need WordPress, the author's infrastructure or an author-issued account. Choose a private local installation on your computer, or a server installation with your own HTTPS domain.

## Local deployment

Install and start Docker Desktop on Windows/macOS, or Docker Engine with Compose v2 on Linux. Download/extract the repository or clone it with Git, then run from its root:

```powershell
# Windows PowerShell: do not change your machine-wide execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

```sh
# macOS / Linux
sh ./scripts/start-local.sh
```

Open `http://127.0.0.1:5488` and register. No server, domain, reverse proxy, SMTP, external image host or host Node.js installation is needed. Local image storage is the default for new users; model API credentials are still required for AI features. The first run builds the application and may take several minutes. The scripts create three independently random credentials in private `.env.local-docker`, never print them, and reuse the existing file on later runs.

The local Compose stack publishes only `127.0.0.1:5488`; PostgreSQL and Redis have no host ports. Its separately named database, Redis and image volumes persist across container restarts. Keep those volumes and `.env.local-docker` together; **do not run `docker compose down -v` or prune volumes**. Rerun the same script to start/update the local application. Use `-Port 5490` (PowerShell) or `--port 5490` (shell) only when creating a fresh local configuration; existing configurations retain their port and keys.

Local mode is explicit `APP_DEPLOYMENT_MODE=local` and accepts only strict HTTP loopback origins (`localhost`, `127.0.0.1` or `[::1]`). It disables mandatory signup email verification and prints password-reset links to the local container log. Treat that log as private. Do not expose this mode to a LAN or public reverse proxy; use server mode instead. Local mode does not disable SSRF checks for model APIs or external image services.

## Server requirements

- Linux host with Git, Docker Engine, Docker Compose v2, `curl` and OpenSSL.
- A DNS name pointing to the host and an HTTPS reverse proxy such as Nginx or Caddy.
- **Working SMTP before server-mode signup.** Server mode requires email verification; without a delivery-capable mail configuration, users cannot complete signup and login. The loopback-only local mode above is not a public-server workaround.
- Images can use the persistent instance-local storage (default for new users) or an optional public HTTPS [Picbed-compatible service](storage-providers.md), selected by each user after login.
- For AI features: a compatible model API and credentials, configured after login. Text-only notes do not require AI or image-storage configuration.

The Docker build provides Node.js and application dependencies. You do **not** need Node.js or npm on the production host. Local development and building the Chrome extension from source use Node.js 22 and npm instead. Leave enough free memory and disk for an image build, PostgreSQL data and backups; no measured minimum hardware specification is claimed.

## 1. Clone and create a private configuration

The paths below are examples, not project requirements. They match the bundled systemd templates. The environment and backup directories are deliberately outside the Git checkout.

```bash
sudo install -d -m 0755 /opt/prompt-notebook
sudo git clone https://github.com/shynloc/prompt-notebook.git /opt/prompt-notebook/current
cd /opt/prompt-notebook/current
sudo install -m 0600 deploy/.env.production.example /opt/prompt-notebook/.env
sudo install -d -m 0700 /opt/prompt-notebook/backups
```

Generate three **different** values locally:

```bash
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
```

Use them respectively for `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and the key in `CREDENTIAL_ENCRYPTION_KEYS=primary:<third-value>`. Keep `CREDENTIAL_ACTIVE_KEY_ID=primary`. A hex database password avoids reserved characters in the Compose PostgreSQL connection URL. Do not paste generated values into issues, chat screenshots or Git commits.

Edit `/opt/prompt-notebook/.env` with your preferred privileged editor:

| Setting | What to provide |
|---|---|
| `APP_URL` | Your public origin, for example `https://prompts.example.com`; use the same origin in DNS, proxy and Chrome extension |
| `POSTGRES_PASSWORD` | First generated value |
| `BETTER_AUTH_SECRET` | Second generated value, at least 32 characters |
| `CREDENTIAL_ENCRYPTION_KEYS` | `primary:` followed by the third generated value |
| `CREDENTIAL_ACTIVE_KEY_ID` | `primary` |
| `BETTER_AUTH_IP_ADDRESS_HEADERS` | `x-real-ip` when using the bundled Nginx configuration |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | A working SMTP server, port and permitted sender |
| `SMTP_USER`, `SMTP_PASSWORD` | Your mail provider's credentials when authentication is required |

Port 465 uses implicit TLS; 587 uses the provider's STARTTLS support. The sender must be permitted by your mail provider. Back up the credential key ring separately from the database: losing it prevents decrypting saved model and image-host credentials.

## 2. Build and start the application

Run from the checkout root:

```bash
sudo env ENV_FILE=/opt/prompt-notebook/.env ./scripts/deploy-production.sh
curl --fail http://127.0.0.1:5488/health/ready
```

The script builds the web/worker image, starts PostgreSQL and Redis, runs database migrations, then starts the web and generation-worker containers. It binds the web service to loopback port `5488` by default. If you change `APP_PORT`, use that port in both your proxy and readiness checks.

A ready response verifies application infrastructure, **not SMTP delivery or a model/image-host connection**. Those are verified separately in the next steps. PostgreSQL and Redis must not be published to the public internet.

## 3. Configure DNS, HTTPS and the reverse proxy

Adapt [the Nginx example](../deploy/nginx/prompt-notebook.conf.example):

1. Replace the example hostname and certificate paths with your own domain and valid certificate.
2. Proxy to `http://127.0.0.1:5488` or your chosen `APP_PORT`.
3. Retain a request limit of at least `45m`; ImageHub limits multipart uploads to 44 MiB including overhead.
4. Overwrite `X-Real-IP` with the proxy's verified client address, as the example does. Do not forward an arbitrary browser-provided value unchanged.
5. Keep the application port private. Use only ports 80/443 publicly as required by your proxy and certificate flow.

Cloudflare is optional. If you add a CDN or another proxy hop, configure the final proxy's trusted real-IP handling before enabling client-IP headers; see [configuration](configuration.md#authentication-client-ips). Do not copy an unverified public forwarding header into the authentication trust configuration.

After validating and reloading your proxy, check the public endpoint:

```bash
curl --fail https://prompts.example.com/health/live
curl --fail https://prompts.example.com/health/ready
```

Replace `prompts.example.com` with your actual host. No Node.js smoke-test command is required for this Docker-only installation.

## 4. Complete first-use verification

1. Open your HTTPS origin, register a new account, receive the verification email and follow its link. Confirm that login still works after a page refresh. If mail does not arrive, resolve SMTP authentication, sender policy and spam filtering before continuing.
2. Save a text-only note. Open a second device and confirm the same note appears after login; formal notes live in PostgreSQL, not only browser storage.
3. Open **Settings → Image storage** and test the default instance-local storage, or select an external compatible upload endpoint and token. A local test writes/deletes a small probe; an external test uploads a small image to that service.
4. Open **Settings → AI models**, add your own OpenAI-compatible API Base URL, key and model ID, then assign model purposes. Connection testing reads the model list; it does not run a paid generation or prove every advertised model capability.
5. Create a note with a photo or submit a small image-generation task to verify the complete media workflow. Real model requests may be billed by your provider.
6. Download the [Chrome extension ZIP](https://github.com/shynloc/prompt-notebook/releases/latest/download/prompt-notebook-chrome.zip), unpack it, enable developer mode at `chrome://extensions`, and load the unpacked folder. In the extension, enter your own HTTPS origin, verify it and authorize the connection. See the [README extension guide](../README.md#chrome-extension).

Model and image-host APIs must be publicly reachable HTTPS endpoints on port 443; private-network or localhost services are rejected for SSRF protection. The built-in image adapter is Picbed-compatible, not a generic direct S3/R2/Cloudinary adapter. See [configuration](configuration.md#user-configured-endpoints) for the supported contract.

## Backups and optional automatic updates

Read [backup checks and restore drills](backup-and-restore.md) before relying on a backup. The script checks `pg_dump` success separately before compressing and publishing; gzip/SHA checks still do not prove a complete logical restore. Keep an independently verified off-host database backup, the instance-local image volume or external image-host files, and a separate credential-key backup.

Review all paths and service users before installing the units. With the example `/opt/prompt-notebook` layout:

```bash
sudo install -m 0644 deploy/systemd/prompt-notebook-backup.* /etc/systemd/system/
sudo install -m 0644 deploy/systemd/prompt-notebook-update.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prompt-notebook-backup.timer
sudo systemctl start prompt-notebook-backup.service
```

Automatic updates are optional and should be enabled only after independent backups and a restore drill are in place:

```bash
sudo systemctl enable --now prompt-notebook-update.timer
```

The updater fetches the configured remote/branch (default `origin/main`) every five minutes. A changed revision triggers the bundled backup command, an image build, forward migration and readiness probe. A failed deployment attempts to restore the previous **application** revision; it does not undo schema migrations or restore the database. Tracked local changes stop updates rather than being overwritten.

For stricter change control, leave the update timer disabled, read release notes, back up independently and deploy reviewed release tags manually with `scripts/deploy-production.sh`.
