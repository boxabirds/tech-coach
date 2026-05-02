#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$ROOT_DIR/.tmp/claude-brownfield-e2e/$(date -u +%Y%m%dT%H%M%SZ)"
CLAUDE_BIN="${CLAUDE_BIN:-}"

if [ -z "$CLAUDE_BIN" ] && [ -x "/Users/julian/.local/bin/claude" ]; then
  CLAUDE_BIN="/Users/julian/.local/bin/claude"
fi
if [ -z "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(command -v claude || true)"
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "claude is required for Claude brownfield e2e tests." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  REPOS="$*"
else
  REPOS="/Users/julian/expts/jp8 /Users/julian/expts/claude-backlog /Users/julian/expts/macscreencap"
fi

assert_file() {
  if [ ! -s "$1" ]; then
    echo "Expected non-empty file: $1" >&2
    exit 1
  fi
}

assert_contains() {
  if ! grep -F "$2" "$1" >/dev/null 2>&1; then
    echo "Expected $1 to contain: $2" >&2
    exit 1
  fi
}

assert_not_contains() {
  if grep -F "$2" "$1" >/dev/null 2>&1; then
    echo "Expected $1 not to contain: $2" >&2
    exit 1
  fi
}

mkdir -p "$RUN_DIR"

for repo in $REPOS; do
  if [ ! -d "$repo" ]; then
    echo "Repository not found: $repo" >&2
    exit 1
  fi

  name="$(basename "$repo")"
  output="$RUN_DIR/$name.output.txt"
  echo "== $name =="

  (
    cd "$repo"
    "$CLAUDE_BIN" \
      --plugin-dir "$ROOT_DIR" \
      --allowedTools "mcp__plugin_tech-coach_tech-coach__*" \
      -p \
      "/tech-coach:architecture-coach"
  ) >"$output" 2>&1

  assert_file "$repo/.ceetrix/tech-lead/tech-lead.db"
  assert_file "$repo/.ceetrix/tech-lead/latest-assessment.md"
  assert_file "$repo/.ceetrix/tech-lead/latest-assessment.json"
  assert_file "$repo/.ceetrix/tech-lead/next-actions.md"
  assert_file "$repo/.ceetrix/tech-lead/questions.json"
  assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Observed Architecture Shape"
  assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "Next Actions"
  assert_not_contains "$output" "API Error"
  assert_not_contains "$output" "Invalid authentication"

  case "$name" in
    jp8)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "React/TypeScript"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Rust/WASM"
      assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "package_boundary/add_targeted_test_harness"
      ;;
    claude-backlog)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "apps/web"
      assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "authentication/add_targeted_test_harness"
      assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "deployment/add_targeted_test_harness"
      ;;
    macscreencap)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Swift/macOS"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "ScreencapMenuBar/Package.swift"
      assert_not_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "chrome_profile"
      assert_not_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Code Cache"
      ;;
  esac

  echo "   output: $output"
done

echo "Claude brownfield e2e passed. Logs: $RUN_DIR"
