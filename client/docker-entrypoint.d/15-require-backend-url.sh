#!/bin/sh
# Runs before the nginx image renders /etc/nginx/templates (20-envsubst-on-templates.sh).
# Fail fast: without a valid BACKEND_URL the /api/, /api/talk/ws and /socket.io/ proxies cannot work,
# and a URL with a path would make nginx rewrite the request URI.
set -eu

fail() {
  echo "$0: $1" >&2
  exit 1
}

[ -n "${BACKEND_URL:-}" ] || fail "BACKEND_URL is not set (e.g. http://<api-service>.<namespace>.svc:3000)"

case "$BACKEND_URL" in
  http://*|https://*) ;;
  *) fail "BACKEND_URL must start with http:// or https:// (got '$BACKEND_URL')" ;;
esac

case "${BACKEND_URL#*://}" in
  */*) fail "BACKEND_URL must be scheme://host:port with no path or trailing slash (got '$BACKEND_URL')" ;;
esac
