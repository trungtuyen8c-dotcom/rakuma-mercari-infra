#!/usr/bin/env bash
# Runs ON THE VPS (called by the backend/frontend deploy workflows).
# Usage: release.sh backend|web vX.Y.Z
# Pins the new tag in .env, recreates only that service (never db), health-checks,
# and restores the previous tag if the service does not come up healthy.
set -euo pipefail
svc=${1:?service}; tag=${2:?tag}
case "$svc" in
  backend) var=BACKEND_TAG ;;
  web) var=WEB_TAG ;;
  *) echo "unknown service $svc" >&2; exit 2 ;;
esac
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad tag $tag" >&2; exit 2; }
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

prev=$(grep -E "^${var}=" .env | cut -d= -f2- || true)
set_tag() {
  if grep -qE "^${var}=" .env; then sed -i "s/^${var}=.*/${var}=$1/" .env; else echo "${var}=$1" >> .env; fi
}
healthy() {
  for _ in $(seq 1 20); do
    curl -fsS http://localhost/healthz >/dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

echo "release $svc: ${prev:-none} -> $tag"
set_tag "$tag"
$C pull "$svc"
$C up -d --no-deps "$svc"
if healthy; then
  docker image prune -f >/dev/null
  echo "RELEASED $svc $tag"
  exit 0
fi

echo "health check failed for $svc $tag" >&2
$C logs --tail=50 "$svc" >&2 || true
if [ -n "$prev" ] && [ "$prev" != "$tag" ]; then
  echo "rolling back $svc to $prev" >&2
  set_tag "$prev"
  $C up -d --no-deps "$svc"
  healthy && echo "ROLLED BACK $svc to $prev" >&2
fi
exit 1
