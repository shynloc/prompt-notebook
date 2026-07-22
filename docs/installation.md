# Installation

## Requirements

- Linux host with Git, Docker Engine and Docker Compose v2
- DNS name and HTTPS reverse proxy
- SMTP account when email verification and password reset are required
- Picbed-compatible HTTPS image host, configured by each user after login

## Clean installation

```bash
sudo install -d -m 0755 /opt/prompt-notebook
sudo git clone https://github.com/shynloc/prompt-notebook.git /opt/prompt-notebook/current
cd /opt/prompt-notebook/current
sudo cp deploy/.env.production.example /opt/prompt-notebook/.env
sudo chmod 600 /opt/prompt-notebook/.env
```

Edit `/opt/prompt-notebook/.env`, then run:

```bash
sudo ENV_FILE=/opt/prompt-notebook/.env ./scripts/deploy-production.sh
```

Configure the reverse proxy from `deploy/nginx/prompt-notebook.conf.example`. PostgreSQL and Redis must never be published publicly.

After registration, configure image storage under `/settings/storage` and model connections under `/settings/ai`.

## Verified backups and automatic updates

Review paths before installing the units:

```bash
sudo install -m 0644 deploy/systemd/prompt-notebook-backup.* /etc/systemd/system/
sudo install -m 0644 deploy/systemd/prompt-notebook-update.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prompt-notebook-backup.timer prompt-notebook-update.timer
sudo systemctl start prompt-notebook-backup.service
```

The update timer polls public `main` every five minutes. A changed revision triggers a verified database backup, immutable image build, forward migration and readiness probe. A failed readiness probe restores the previous application revision. Tracked local changes stop auto-update rather than being overwritten.

For stricter change control, disable the update timer and deploy reviewed release tags manually with `scripts/deploy-production.sh`.
