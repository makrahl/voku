#!/usr/bin/env bash
# Nightly backup. SQLite must be copied with .backup rather than cp — a plain
# copy of a live WAL database can be torn.
#
# The database lives on the host via the compose bind mount, so this needs
# neither root nor a running container. Needs the sqlite3 CLI (apt install
# sqlite3).
#
#   0 2 * * *  $HOME/apps/voku/deploy/backup.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DATABASE_PATH:-$HERE/data/voku.db}"
DEST="${VOKU_BACKUP_DIR:-$HERE/backups}"
KEEP_DAYS="${VOKU_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d)"
sqlite3 "$DB" ".backup '$DEST/voku-$STAMP.db'"
gzip -f "$DEST/voku-$STAMP.db"

find "$DEST" -name 'voku-*.db.gz' -mtime "+$KEEP_DAYS" -delete
echo "backed up to $DEST/voku-$STAMP.db.gz"
