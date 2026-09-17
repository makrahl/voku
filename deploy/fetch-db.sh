#!/usr/bin/env bash
# Writes the newest nightly backup to stdout, gzipped, with the provider key
# removed. Meant to be the forced command on a restricted SSH key, so that
# fetching a working copy of the data does not also hand out a shell:
#
#   command="/home/tilman/apps/voku/deploy/fetch-db.sh",restrict ssh-ed25519 AAAA... teacher
#
# Then, on the other machine: ssh voku-db > voku.db.gz
#
# The key is stripped because it lives in the settings table, so a copy of the
# database is a copy of the credential — the one thing that must not spread to a
# laptop. Student login tokens do travel with it; they are the QR codes their own
# teacher prints anyway, but it is why this goes to a colleague and not further.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LATEST="$(ls -1t backups/voku-*.db.gz 2>/dev/null | head -1)"
if [ -z "$LATEST" ]; then
  echo "no backup found in $PWD/backups" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gzip -dc "$LATEST" > "$TMP/voku.db"
sqlite3 "$TMP/voku.db" "delete from settings where key = 'llm';"
gzip -c "$TMP/voku.db"
