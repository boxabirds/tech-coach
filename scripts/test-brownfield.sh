#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to run the local brownfield integration test." >&2
  echo "Install bun, then rerun: $0" >&2
  exit 1
fi

exec bun "$ROOT_DIR/scripts/brownfield-assess.ts" "$@"
