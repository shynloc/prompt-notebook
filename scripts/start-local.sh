#!/usr/bin/env sh
set -eu

REPOSITORY_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
ENV_FILE="$REPOSITORY_ROOT/.env.local-docker"
PORT=5488
CONFIGURE_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) test "$#" -ge 2 || { echo 'Missing port' >&2; exit 2; }; PORT="$2"; shift 2 ;;
    --configure-only) CONFIGURE_ONLY=1; shift ;;
    *) echo 'Usage: start-local.sh [--port 5488] [--configure-only]' >&2; exit 2 ;;
  esac
done
case "$PORT" in ''|*[!0-9]*|0*) echo 'Port must be an integer from 1 to 65535' >&2; exit 2 ;; esac
[ "$PORT" -le 65535 ] || { echo 'Port must be at most 65535' >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Desktop or Docker Engine with Compose v2 first.' >&2; exit 2; }
docker info --format '{{.ServerVersion}}' >/dev/null

if [ -L "$ENV_FILE" ] || { [ -e "$ENV_FILE" ] && [ ! -f "$ENV_FILE" ]; }; then
  echo 'Refusing a non-regular local environment file.' >&2
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  TEMP="$(mktemp "$REPOSITORY_ROOT/.env.local-docker.XXXXXX")"
  trap 'rm -f "$TEMP"' EXIT HUP INT TERM
  # Docker supplies Node's cryptographic RNG; no host Node/OpenSSL is required.
  docker run --rm --network none node:22-alpine node -e '
    const { randomBytes } = require("node:crypto");
    process.stdout.write([
      "# Private local configuration; generated once. Do not commit or share.",
      "APP_PORT=" + process.argv[1],
      "POSTGRES_PASSWORD=" + randomBytes(24).toString("hex"),
      "BETTER_AUTH_SECRET=" + randomBytes(32).toString("hex"),
      "CREDENTIAL_ENCRYPTION_KEYS=local:" + randomBytes(32).toString("hex"),
      "LOCAL_MEDIA_QUOTA_BYTES=1073741824", "LOCAL_MEDIA_MIN_FREE_BYTES=268435456", "AI_IMAGE_TIMEOUT_MS=600000", ""
    ].join("\n"));
  ' "$PORT" > "$TEMP"
  # Atomic publication refuses to overwrite an existing configuration.
  if ln "$TEMP" "$ENV_FILE" 2>/dev/null; then
    echo 'Created private local configuration with independent random credentials.'
  else
    test -f "$ENV_FILE" || { echo 'Could not publish local configuration.' >&2; exit 2; }
  fi
  rm -f "$TEMP"
  trap - EXIT HUP INT TERM
fi
chmod 600 "$ENV_FILE"
PORT="$(sed -n 's/^APP_PORT=//p' "$ENV_FILE" | tail -n 1)"
case "$PORT" in ''|*[!0-9]*|0*) echo 'Existing APP_PORT is invalid' >&2; exit 2 ;; esac
[ "$PORT" -le 65535 ] || { echo 'Existing APP_PORT is invalid' >&2; exit 2; }
if [ "$CONFIGURE_ONLY" = 1 ]; then echo "Configuration ready for http://127.0.0.1:$PORT"; exit 0; fi

compose() {
  docker compose --project-name prompt-notebook-local --env-file "$ENV_FILE" -f "$REPOSITORY_ROOT/deploy/compose.local.yml" "$@"
}
compose config --quiet
compose build web
compose up -d postgres redis
compose run --rm migrate
compose up -d --no-deps web generation-worker
attempt=0
until compose exec -T web wget -qO- http://127.0.0.1:3000/health/ready >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then echo 'Local app is not ready; check Docker logs without deleting volumes.' >&2; exit 1; fi
  sleep 2
done
echo "Prompt Notebook is ready: http://127.0.0.1:$PORT"
echo 'Register locally without SMTP. Preserve Docker volumes and .env.local-docker.'
