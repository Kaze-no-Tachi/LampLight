#!/usr/bin/env bash
#
# Restores a Lamplight backup, and by default restores it somewhere harmless.
#
#   scripts/restore.sh backups/lamplight-20260817T000000Z.dump
#   scripts/restore.sh <file> --into lamplight_restore_check    # a drill
#   scripts/restore.sh <file> --into lamplight --i-mean-it      # the real thing
#
# WHY THE DEFAULT IS A SCRATCH DATABASE
#
# The only way to know a backup works is to restore it, and the only way people
# actually do that regularly is if doing it is safe. Restoring into a scratch
# database is a drill anybody can run on a Tuesday against production data with
# nothing at stake. Overwriting the live database is a different act and needs
# a different flag, typed out.
#
# WHAT HAS TO EXIST FIRST
#
# The roles. pg_dump writes a database, not a cluster, so lamplight_app and
# lamplight_admin have to be there before the GRANTs and row-level security
# policies in the dump can apply. On a rebuilt box that is what
# docker/postgres/init does on first start.

set -euo pipefail

FILE="${1:-}"
TARGET_DB=""
CONFIRMED="no"

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --into)
      TARGET_DB="${2:-}"
      shift 2
      ;;
    --i-mean-it)
      CONFIRMED="yes"
      shift
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "usage: scripts/restore.sh <dump-file> [--into <database>] [--i-mean-it]" >&2
  exit 1
fi

if [ -z "${DATABASE_ADMIN_URL:-}" ]; then
  echo "DATABASE_ADMIN_URL is not set. Source your environment first." >&2
  exit 1
fi

# Everything but the database name, so a target can be substituted.
BASE_URL="${DATABASE_ADMIN_URL%/*}"
LIVE_DB="${DATABASE_ADMIN_URL##*/}"
LIVE_DB="${LIVE_DB%%\?*}"
TARGET_DB="${TARGET_DB:-lamplight_restore_check}"

if [ "${TARGET_DB}" = "${LIVE_DB}" ] && [ "${CONFIRMED}" != "yes" ]; then
  echo "Refusing to restore over ${LIVE_DB}, which is the live database." >&2
  echo "Run a drill instead:" >&2
  echo "  scripts/restore.sh ${FILE} --into lamplight_restore_check" >&2
  echo "Or, if you really mean it, add --i-mean-it." >&2
  exit 1
fi

echo "checking the roles the dump expects exist"
for role in lamplight_app lamplight_admin; do
  if ! psql "${DATABASE_ADMIN_URL}" -tAc \
    "select 1 from pg_roles where rolname = '${role}'" | grep -q 1; then
    echo "role ${role} is missing. Bring up the stack so the init scripts run." >&2
    exit 1
  fi
done

echo "restoring ${FILE} into ${TARGET_DB}"

# Dropped and recreated rather than restored on top. A restore into a database
# that still holds rows is a merge, and a merge of two states of the same
# system is not a restore of either.
psql "${BASE_URL}/postgres" -v ON_ERROR_STOP=1 -c \
  "drop database if exists ${TARGET_DB} with (force)" > /dev/null
psql "${BASE_URL}/postgres" -v ON_ERROR_STOP=1 -c \
  "create database ${TARGET_DB}" > /dev/null

# --no-owner because the dump was taken that way, and --single-transaction so a
# restore that fails halfway leaves nothing behind to be mistaken for a
# database.
pg_restore \
  --dbname="${BASE_URL}/${TARGET_DB}" \
  --no-owner \
  --single-transaction \
  "${FILE}"

echo
echo "what came back:"
psql "${BASE_URL}/${TARGET_DB}" -tAc "
  select 'tenants: ' || count(*) from tenants
  union all select 'users: ' || count(*) from users
  union all select 'memberships: ' || count(*) from memberships
  union all select 'enrollments: ' || count(*) from enrollments
  union all select 'lessons: ' || count(*) from lessons
"

# The check that matters most and is easiest to forget. Row-level security is
# the second half of the isolation model, and a restore that dropped the
# policies would produce a database that looks complete and enforces nothing.
POLICIES="$(psql "${BASE_URL}/${TARGET_DB}" -tAc \
  "select count(*) from pg_policies where policyname = 'tenant_isolation'")"
FORCED="$(psql "${BASE_URL}/${TARGET_DB}" -tAc \
  "select count(*) from pg_class where relrowsecurity and relforcerowsecurity")"

echo "row-level security: ${POLICIES} isolation policies, ${FORCED} tables forcing it"

if [ "${POLICIES}" -lt 1 ] || [ "${FORCED}" -lt 1 ]; then
  echo "The data restored but the isolation policies did not. Do not use this." >&2
  exit 1
fi

echo
echo "restore into ${TARGET_DB} succeeded."
if [ "${TARGET_DB}" != "${LIVE_DB}" ]; then
  echo "Drop it when you have finished looking:"
  echo "  psql \"${BASE_URL}/postgres\" -c 'drop database ${TARGET_DB}'"
fi
