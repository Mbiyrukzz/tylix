#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${1:-demo-app}"
WORK_DIR="${TMPDIR:-/tmp}/tylix-local-test"
PORT="${PORT:-3000}"

echo "==> Installing monorepo"
cd "$ROOT"
npm install

echo "==> Scaffolding $APP_NAME in $WORK_DIR (outside the monorepo)"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
TYLIX_LOCAL=1 node "$ROOT/packages/create-tylix/src/index.js" "$APP_NAME"

cd "$APP_NAME"
echo "==> Installing app"
npm install

echo "==> Checking links"
fail=0
for d in node_modules/@tylix/* node_modules/tylix-icons; do
  [ -e "$d" ] || continue
  if [ -L "$d" ]; then
    echo "  linked   $d -> $(readlink "$d")"
  else
    echo "  NOT LINKED  $d (resolved from the registry)"
    fail=1
  fi
done

echo "==> Checking for duplicate copies"
npm ls @tylix/core @tylix/shared @tylix/orm @tylix/compiler || fail=1

echo "==> Booting dev server"
npm run dev > dev.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fs "http://localhost:$PORT" > /dev/null 2>&1; then break; fi
  sleep 1
done

EXPECTED="$(node -p "require('$ROOT/packages/cli/package.json').version")"
if grep -q "v$EXPECTED" dev.log; then
  echo "  banner shows v$EXPECTED"
else
  echo "  banner version mismatch (expected v$EXPECTED)"
  fail=1
fi

curl -fsI "http://localhost:$PORT" | head -1 || fail=1

echo
if [ "$fail" -eq 0 ]; then echo "PASS"; else echo "FAIL (see dev.log in $WORK_DIR/$APP_NAME)"; exit 1; fi