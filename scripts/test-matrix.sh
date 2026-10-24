#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/tylix-matrix"
BASE_PORT="${BASE_PORT:-4100}"
EXPECTED="$(node -p "require('$ROOT/packages/cli/package.json').version")"

# Databases that need no external server. Add mysql/postgres/mongodb
# via DBS="sqlite mysql" once those servers are running locally.
DBS="${DBS:-sqlite none}"
LANGS="${LANGS:-js ts}"
AUTHS="${AUTHS:-yes no}"
TEMPLATES="${TEMPLATES:-starter blank}"
STYLINGS="${STYLINGS:-plain-css}"

PASSED=(); FAILED=()
DEV_PID=""
cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null; DEV_PID=""; }
trap cleanup EXIT

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

expect() { # expect <label> <actual> <allowed codes...>
  local label="$1" actual="$2"; shift 2
  for ok in "$@"; do [ "$actual" = "$ok" ] && { echo "    ok   $label ($actual)"; return 0; }; done
  echo "    FAIL $label (got $actual, wanted $*)"; return 1
}

run_case() {
  local lang="$1" db="$2" auth="$3" tpl="$4" style="$5" port="$6"
  local name="app-$lang-$db-auth$auth-$tpl-$style"
  local dir="$WORK/$name" log="$WORK/$name.log" fail=0

  echo "==> $name"
  mkdir -p "$WORK"; rm -rf "$dir"

  (cd "$WORK" && TYLIX_LOCAL=1 node "$ROOT/packages/create-tylix/src/index.js" "$name" \
      --yes --language "$lang" --database "$db" --auth "$auth" \
      --styling "$style" --template "$tpl" --no-git) > "$log" 2>&1 \
    || { echo "    FAIL scaffold (see $log)"; FAILED+=("$name: scaffold"); return; }

  cd "$dir" || return
  sed -i "s/^PORT=.*/PORT=$port/" .env

  npm install >> "$log" 2>&1 || { echo "    FAIL npm install"; FAILED+=("$name: install"); return; }

  # 1. Every @tylix package must be a symlink into the monorepo.
  for d in node_modules/@tylix/* node_modules/tylix-icons; do
    [ -e "$d" ] || continue
    [ -L "$d" ] || { echo "    FAIL not linked: $d"; fail=1; }
  done
  # An auth-off app must still resolve auth through core, but via the local copy.
  if [ "$auth" = "no" ] && [ -d node_modules/@tylix/auth ] && [ ! -L node_modules/@tylix/auth ]; then
    echo "    FAIL @tylix/auth resolved from registry"; fail=1
  fi

  # 2. One copy of each core package.
  npm ls @tylix/core @tylix/shared @tylix/orm >> "$log" 2>&1 || { echo "    FAIL duplicate or missing packages"; fail=1; }

  # 3. Type check (TypeScript only).
  if [ "$lang" = "ts" ]; then
    npm run typecheck >> "$log" 2>&1 && echo "    ok   typecheck" || { echo "    FAIL typecheck"; fail=1; }
  fi

  # 4. Migrations (skipped when there is no database).
  if [ "$db" != "none" ]; then
    npm run migrate >> "$log" 2>&1 && echo "    ok   migrate" || { echo "    FAIL migrate"; fail=1; }
  fi

  # 5. Boot the dev server.
  npm run dev > dev.log 2>&1 &
  DEV_PID=$!
  local up=0
  for _ in $(seq 1 30); do
    [ "$(code "http://localhost:$port/")" != "000" ] && { up=1; break; }
    sleep 1
  done
  if [ "$up" -eq 0 ]; then
    echo "    FAIL server did not start (see $dir/dev.log)"
    cleanup; FAILED+=("$name: boot"); return
  fi

  grep -q "v$EXPECTED" dev.log && echo "    ok   banner v$EXPECTED" || { echo "    FAIL banner version"; fail=1; }

  # 6. Routes.
  if [ "$tpl" = "starter" ]; then
    expect "GET /" "$(code "http://localhost:$port/")" 200 || fail=1
  fi

  if [ "$auth" = "yes" ]; then
    expect "GET /login"    "$(code "http://localhost:$port/login")"    200 || fail=1
    expect "GET /register" "$(code "http://localhost:$port/register")" 200 || fail=1

       if [ "$db" != "none" ]; then
      local email="t$RANDOM@example.com" jar="$dir/cookies.txt"
      expect "POST /api/register" "$(code -X POST "http://localhost:$port/api/register" \
        -H 'Content-Type: application/json' \
        -d "{\"name\":\"Test\",\"email\":\"$email\",\"password\":\"password123\"}")" 200 201 || fail=1

      # Login must be refused until the email is verified.
      expect "POST /api/login blocked before verification" "$(code -X POST "http://localhost:$port/api/login" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"$email\",\"password\":\"password123\"}")" 403 || fail=1

      # The model strips email_verified_at on create, so set it directly.
      if node --no-warnings "$ROOT/scripts/verify-user.mjs" "$dir/database.sqlite" "$email" 2>> "$log"; then
        echo "    ok   marked $email verified"
      else
        echo "    FAIL could not mark user verified (see $log)"; fail=1
      fi

      # Tokens are delivered as cookies, so keep them in a jar.
      rm -f "$jar"
      expect "POST /api/login" "$(code -c "$jar" -X POST "http://localhost:$port/api/login" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"$email\",\"password\":\"password123\"}")" 200 || fail=1
      expect "GET /api/me (cookie auth)" "$(code -b "$jar" "http://localhost:$port/api/me")" 200 || fail=1
    fi
  else
    # Auth disabled: its routes must not exist.
    expect "POST /api/register absent" "$(code -X POST "http://localhost:$port/api/register")" 404 || fail=1
    expect "GET /api/me absent" "$(code "http://localhost:$port/api/me")" 404 || fail=1
  fi

  cleanup
  if [ "$fail" -eq 0 ]; then PASSED+=("$name"); else FAILED+=("$name"); fi
}

echo "==> Installing monorepo"
(cd "$ROOT" && npm install --silent) || exit 1
rm -rf "$WORK"

port="$BASE_PORT"
for lang in $LANGS; do
 for db in $DBS; do
  for auth in $AUTHS; do
   # Auth needs a database.
   [ "$db" = "none" ] && [ "$auth" = "yes" ] && continue
   for tpl in $TEMPLATES; do
    for style in $STYLINGS; do
      run_case "$lang" "$db" "$auth" "$tpl" "$style" "$port"
      port=$((port + 1))
    done
   done
  done
 done
done

echo
echo "Passed: ${#PASSED[@]}   Failed: ${#FAILED[@]}"
for f in "${FAILED[@]}"; do echo "  FAIL $f"; done
[ "${#FAILED[@]}" -eq 0 ]