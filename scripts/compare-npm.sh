#!/usr/bin/env bash
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf "%-24s %-10s %-10s %s\n" "PACKAGE" "LOCAL" "NPM" "STATUS"

for dir in packages/*/; do
  dir="${dir%/}"
  [ -f "$dir/package.json" ] || continue

  name=$(node -p "require('./$dir/package.json').name")
  localv=$(node -p "require('./$dir/package.json').version")
  npmv=$(npm view "$name" version 2>/dev/null)

  if [ -z "$npmv" ]; then
    printf "%-24s %-10s %-10s %s\n" "$name" "$localv" "-" "NOT ON NPM"; continue
  fi
  if [ "$localv" != "$npmv" ]; then
    printf "%-24s %-10s %-10s %s\n" "$name" "$localv" "$npmv" "VERSION DIFFERS"; continue
  fi

  safe=$(echo "$name" | tr '/@' '__')
  mkdir -p "$TMP/$safe/local" "$TMP/$safe/remote"
  (cd "$dir" && npm pack --silent --pack-destination "$TMP/$safe/local" >/dev/null 2>&1)
  (cd "$TMP/$safe/remote" && npm pack "$name@$npmv" --silent >/dev/null 2>&1)
  tar -xzf "$TMP/$safe/local/"*.tgz  -C "$TMP/$safe/local"
  tar -xzf "$TMP/$safe/remote/"*.tgz -C "$TMP/$safe/remote"

  if diff -rq "$TMP/$safe/local/package" "$TMP/$safe/remote/package" >/dev/null; then
    printf "%-24s %-10s %-10s %s\n" "$name" "$localv" "$npmv" "IDENTICAL"
  else
    printf "%-24s %-10s %-10s %s\n" "$name" "$localv" "$npmv" "CONTENT DIFFERS"
    diff -rq "$TMP/$safe/local/package" "$TMP/$safe/remote/package" | sed 's/^/    /'
  fi
done
