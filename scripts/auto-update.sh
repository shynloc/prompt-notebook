#!/usr/bin/env sh
set -eu

REPOSITORY_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
EXPECTED_ROOT="${EXPECTED_ROOT:-$REPOSITORY_ROOT}"
ENV_FILE="${ENV_FILE:-$REPOSITORY_ROOT/.env}"
LOCK_FILE="${LOCK_FILE:-/tmp/prompt-notebook-update.lock}"
REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"

if [ "$REPOSITORY_ROOT" != "$(CDPATH= cd -- "$EXPECTED_ROOT" && pwd -P)" ]; then
  printf '%s\n' "Refusing to update an unexpected repository path" >&2
  exit 2
fi
if [ ! -d "$REPOSITORY_ROOT/.git" ] || [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' "Auto-update requires a Git clone and configured .env file" >&2
  exit 2
fi
if ! git -C "$REPOSITORY_ROOT" diff --quiet || ! git -C "$REPOSITORY_ROOT" diff --cached --quiet; then
  printf '%s\n' "Refusing to overwrite tracked local changes" >&2
  exit 2
fi

run_update() {
  old_revision="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)"
  git -C "$REPOSITORY_ROOT" fetch --prune "$REMOTE" "$BRANCH"
  new_revision="$(git -C "$REPOSITORY_ROOT" rev-parse "$REMOTE/$BRANCH")"
  if [ "$old_revision" = "$new_revision" ]; then exit 0; fi

  ENV_FILE="$ENV_FILE" BACKUP_DIR="${BACKUP_DIR:-$REPOSITORY_ROOT/backups}" \
    "$REPOSITORY_ROOT/scripts/backup-postgres.sh"

  git -C "$REPOSITORY_ROOT" checkout --detach "$new_revision"
  if ENV_FILE="$ENV_FILE" "$REPOSITORY_ROOT/scripts/deploy-production.sh"; then
    printf '%s\n' "$new_revision" > "$REPOSITORY_ROOT/.deployed-revision"
    printf '%s\n' "Updated Prompt Notebook to $new_revision"
    exit 0
  fi

  printf '%s\n' "Deployment failed; restoring application revision $old_revision" >&2
  git -C "$REPOSITORY_ROOT" checkout --detach "$old_revision"
  ENV_FILE="$ENV_FILE" "$REPOSITORY_ROOT/scripts/deploy-production.sh"
  exit 1
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
  run_update
else
  run_update
fi
