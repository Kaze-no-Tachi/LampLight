#!/bin/sh
# Periodic maintenance, driven by the smallest thing that can drive it.
#
# Calls POST /api/platform/sweep on the application inside the compose network,
# forever, on an interval. The endpoint refreshes unverified custom hostnames
# at Cloudflare, releases lapsed claims, and deletes invitations that have
# outlived their purpose. Before this existed, nothing called it.
#
# WHY A LOOP AND NOT CRON
#
# There is no job runner in this deployment (ADR 0004) and adding one for a
# single periodic task would be the largest new moving part in it. A shell loop
# in a container restarts with the stack, logs where every other service logs,
# and can be read in full in thirty seconds.
#
# It does not exit on failure. The application being briefly down or mid-deploy
# is the ordinary case, and a sweep that gives up the first time the app
# restarts is a sweep that stops running the day it is needed.

set -u

APP_URL="${APP_URL:-http://app:3000}"
INTERVAL="${SWEEP_INTERVAL_SECONDS:-900}"

if [ -z "${DOMAIN_SWEEP_SECRET:-}" ]; then
  # The endpoint answers 404 without a secret, so calling it would be a loop
  # doing nothing every fifteen minutes and looking healthy while it did.
  echo "sweep: DOMAIN_SWEEP_SECRET is not set, so there is nothing to call."
  echo "sweep: set it on both the app and this service, then restart."
  exit 1
fi

echo "sweep: every ${INTERVAL}s against ${APP_URL}"

while true; do
  sleep "${INTERVAL}"

  response=$(
    curl --silent --show-error --max-time 120 \
      --write-out '\n%{http_code}' \
      --request POST \
      --header "x-lamplight-sweep-secret: ${DOMAIN_SWEEP_SECRET}" \
      "${APP_URL}/api/platform/sweep" 2>&1
  )

  status=$(printf '%s' "${response}" | tail -n 1)
  body=$(printf '%s' "${response}" | sed '$d')

  if [ "${status}" = "200" ]; then
    echo "sweep: ${body}"
  else
    # 404 means the secret does not match the one the application has, which
    # is deliberate: the endpoint refuses to distinguish a wrong secret from a
    # path that does not exist. Worth saying plainly here, since this is the
    # one caller that is supposed to know it.
    echo "sweep: failed with ${status}. ${body}"
  fi
done
