#!/usr/bin/env bash
#
# Takes a backup of the Lamplight database.
#
#   scripts/backup.sh [destination-directory]
#
# WHAT IS AND IS NOT IN HERE
#
# Postgres only. Lesson audio lives in object storage, which is versioned and
# replicated by the provider and is not something a shell script on the box
# should be copying around. What this covers is the part that only exists here:
# institutes, people, memberships, enrollments, orders, progress, and the audit
# log. Losing the database loses the record of who paid for what.
#
# Custom format (-Fc), not plain SQL. It is compressed, it restores selectively,
# and pg_restore can list what is inside without applying any of it, which is
# what you want at the moment you are deciding whether a backup is any good.
#
# ROLES ARE NOT IN THE DUMP
#
# pg_dump writes the database, not the cluster's roles. A restore onto a fresh
# server needs lamplight_app and lamplight_admin to exist first, or every GRANT
# and every row-level security policy referring to them fails. The compose
# stack creates them from docker/postgres/init, which is the same path a
# rebuild takes. scripts/restore.sh checks for them before it starts.

set -euo pipefail

DESTINATION="${1:-${BACKUP_DIR:-./backups}}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

if [ -z "${DATABASE_ADMIN_URL:-}" ]; then
  # The admin URL rather than the application one, deliberately: the app role
  # cannot bypass row-level security, so a dump taken as that role would
  # silently contain only the rows visible under whatever app.tenant_id
  # happened to be set, which is none of them. A backup that restores an empty
  # database is worse than no backup, because it looks like one.
  echo "DATABASE_ADMIN_URL is not set. Source your environment first." >&2
  exit 1
fi

mkdir -p "${DESTINATION}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${DESTINATION}/lamplight-${STAMP}.dump"

echo "backing up to ${FILE}"

pg_dump \
  --dbname="${DATABASE_ADMIN_URL}" \
  --format=custom \
  --no-owner \
  --file="${FILE}"

# A dump that cannot be listed is not a backup, and finding that out now costs
# a second. pg_restore --list reads the table of contents without touching a
# database, so this is a real check rather than a file size heuristic.
if ! pg_restore --list "${FILE}" > /dev/null; then
  echo "the dump is unreadable, removing it" >&2
  rm -f "${FILE}"
  exit 1
fi

SIZE="$(du -h "${FILE}" | cut -f1)"
OBJECTS="$(pg_restore --list "${FILE}" | grep -c '^[0-9]' || true)"
echo "wrote ${SIZE}, ${OBJECTS} objects"

# Pruning is last, so a failed backup never deletes a good one.
if [ "${RETAIN_DAYS}" -gt 0 ]; then
  DELETED="$(find "${DESTINATION}" -name 'lamplight-*.dump' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)"
  if [ "${DELETED}" -gt 0 ]; then
    echo "pruned ${DELETED} backup(s) older than ${RETAIN_DAYS} days"
  fi
fi

echo
echo "This file is on the same machine as the database it came from, which"
echo "protects against a bad migration and not against losing the machine."
echo "Copy it somewhere else. See docs/runbook.md."
