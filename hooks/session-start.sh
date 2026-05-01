#!/usr/bin/env sh
set -eu

ROOT_DIR="${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
exec "$ROOT_DIR/bin/archcoach-hook" SessionStart
