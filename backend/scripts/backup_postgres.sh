#!/usr/bin/env sh
# Dump the NexaMind PostgreSQL database to a compressed, timestamped file and prune old dumps.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./backup_postgres.sh [backup_dir] [keep_days]
#
# Uses pg_dump's custom format (restore with pg_restore, see docs/OPERATIONS.md). The URL is read
# from the environment so the password never appears in the process list or shell history.
# Run it from a machine or scheduled job that can reach the database; never against a database
# you have not been authorised to copy.
set -eu

BACKUP_DIR="${1:-./backups}"
KEEP_DAYS="${2:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

# Render/Heroku style URLs and the SQLAlchemy driver prefix are both accepted.
URL=$(printf '%s' "$DATABASE_URL" | sed -e 's#^postgres://#postgresql://#' -e 's#^postgresql+asyncpg://#postgresql://#')

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/nexamind-$STAMP.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$TARGET" --dbname="$URL"
# A dump that pg_restore can't list is not a backup.
pg_restore --list "$TARGET" > /dev/null
echo "Backup written: $TARGET ($(du -h "$TARGET" | cut -f1))"

find "$BACKUP_DIR" -name 'nexamind-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete
