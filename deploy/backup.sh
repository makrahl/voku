#!/usr/bin/env bash
# Nightly backup. SQLite must be copied with .backup rather than cp — a plain
# copy of a live WAL database can be torn.
#
#   0 2 * * *  /srv/voku/deploy/backup.sh
set -euo pipefail

DB="${DATABASE_PATH:-/srv/voku/apps/server/data/voku.db}"
DEST="${VOKU_BACKUP_DIR:-/srv/voku/backups}"
KEEP_DAYS="${VOKU_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d)"
sqlite3 "$DB" ".backup '$DEST/voku-$STAMP.db'"
gzip -f "$DEST/voku-$STAMP.db"

find "$DEST" -name 'voku-*.db.gz' -mtime "+$KEEP_DAYS" -delete
echo "backed up to $DEST/voku-$STAMP.db.gz"
