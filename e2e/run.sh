#!/usr/bin/env bash
# Full-stack e2e: builds backend + frontend, starts an isolated Compose project (rakuma-e2e, web on :18088,
# own DB volume), sets a throwaway owner password, seeds demo data, runs the suite, then tears the stack down.
#   E2E_REF=origin/main ./run.sh   build from that git ref (temporary worktrees) instead of the local working trees
#   FRONTEND_SRC=../path ./run.sh  build that frontend (or BACKEND_SRC) folder instead, e.g. a branch worktree
#   KEEP_STACK=1 ./run.sh          leave the stack running afterwards
#   ./run.sh --headed ...          extra args go to `e2e run`
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
export WEB_PORT=${WEB_PORT:-18088} DB_PORT=${DB_PORT:-55433}
export APP_URL=http://localhost:$WEB_PORT RAKUMA_E2E_URL=http://localhost:$WEB_PORT
export RAKUMA_MCP_DIR=${RAKUMA_MCP_DIR:-$ROOT/rakuma-mercari-mcp}

TMP=$(mktemp -d)
SRC=$ROOT
if [ -n "${E2E_REF:-}" ]; then
  SRC=$TMP/src
  for r in backend frontend mcp; do
    git -C "$ROOT/rakuma-mercari-$r" fetch -q origin
    git -C "$ROOT/rakuma-mercari-$r" worktree add -q --detach "$SRC/rakuma-mercari-$r" "$E2E_REF"
  done
  cp -R "$ROOT/rakuma-mercari-mcp/node_modules" "$SRC/rakuma-mercari-mcp/"
  RAKUMA_MCP_DIR=$SRC/rakuma-mercari-mcp
fi
BACKEND_DIR=$(cd "${BACKEND_SRC:-$SRC/rakuma-mercari-backend}" && pwd)
FRONTEND_DIR=$(cd "${FRONTEND_SRC:-$SRC/rakuma-mercari-frontend}" && pwd)
cat > "$TMP/build.yml" <<EOF
services:
  backend: { build: "$BACKEND_DIR" }
  web: { build: "$FRONTEND_DIR" }
EOF
COMPOSE=(docker compose -p rakuma-e2e -f ../docker-compose.yml -f "$TMP/build.yml")

cleanup() {
  [ "${KEEP_STACK:-}" = 1 ] || "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  if [ -n "${E2E_REF:-}" ]; then
    for r in backend frontend mcp; do git -C "$ROOT/rakuma-mercari-$r" worktree remove --force "$SRC/rakuma-mercari-$r" 2>/dev/null || true; done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --build --wait

export RAKUMA_E2E_PASSWORD=$(openssl rand -hex 12)
echo "$RAKUMA_E2E_PASSWORD" | "${COMPOSE[@]}" exec -T backend set-password >/dev/null
"${COMPOSE[@]}" exec -T backend seed-demo
[ "${KEEP_STACK:-}" = 1 ] && echo "RAKUMA_E2E_PASSWORD=$RAKUMA_E2E_PASSWORD"

[ -d node_modules ] || npm ci
npx e2e run "$@"
