#!/usr/bin/env sh
set -eu

ROOT_DIR="${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
ARCHCOACH_STOP_HOOK_ACTIVE="${ARCHCOACH_STOP_HOOK_ACTIVE:-1}" exec "$ROOT_DIR/bin/archcoach-hook" Stop
