#!/usr/bin/env bash
# Deploys what is on origin/main (or a ref passed as $1, which is how a rollback
# is done). Run by the GitHub Actions workflow over SSH; safe to run by hand.
#
# The order matters: the database is backed up *first*, because a rollback puts
# the old code back but cannot undo a migration that has already run.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REF="${1:-origin/main}"
PREV="$(git rev-parse HEAD)"

echo "==> backing up first"
./deploy/backup.sh

echo "==> fetching $REF"
git fetch origin
# Hard reset rather than pull: this checkout is a deployment, not a workspace.
# Anything edited on the server by hand is meant to lose to the repository.
git reset --hard "$REF"
echo "    now at $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

echo "==> building and starting"
docker compose up -d --build

# A container that starts is not an app that serves: a failed migration or a bad
# bundle path both leave it "running" and useless. Ask the app itself.
echo "==> waiting for health"
for _ in $(seq 1 30); do
  if curl -fsS -m 3 http://127.0.0.1:3200/api/health >/dev/null 2>&1; then
    echo "    healthy at $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "!!! health check failed after 60s — rolling back to ${PREV:0:7}" >&2
git reset --hard "$PREV"
docker compose up -d --build
echo "!!! rolled back. The site is on the previous version; your change is not live." >&2
exit 1
