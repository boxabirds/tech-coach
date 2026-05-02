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

CLEAN=1
REPOS=""
for arg in "$@"; do
  case "$arg" in
    --clean)
      CLEAN=1
      ;;
    --no-clean)
      CLEAN=0
      ;;
    *)
      REPOS="${REPOS}${REPOS:+ }$arg"
      ;;
  esac
done

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

if [ -z "$REPOS" ]; then
  REPOS="$ROOT_DIR/fixtures/brownfield-repos/runtime-boundary $ROOT_DIR/fixtures/brownfield-repos/rich-auth-platform $ROOT_DIR/fixtures/brownfield-repos/mac-package-deploy"
fi

for repo in $REPOS; do
  if [ ! -d "$repo" ]; then
    echo "Repository not found: $repo" >&2
    exit 1
  fi

  name="$(basename "$repo")"
  output="$RUN_DIR/$name.output.txt"
  echo "== $name =="

  if [ "$CLEAN" = "1" ]; then
    rm -rf "$repo/.ceetrix/tech-lead"
    echo "   reset: $repo/.ceetrix/tech-lead"
  fi

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
  assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Generated report from the repo-local Ceetrix Tech Lead SQLite store"
  assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "Baseline Readout"
  assert_not_contains "$output" "API Error"
  assert_not_contains "$output" "Invalid authentication"
  assert_not_contains "$output" "exceeds maximum allowed tokens"
  assert_not_contains "$output" "/tool-results/"
  assert_not_contains "$output" "Brownfield assessment:"
  assert_not_contains "$output" "Change assessment:"
  assert_not_contains "$output" "Structure review:"
  assert_not_contains "$output" "Horizon scan:"

  case "$name" in
    runtime-boundary)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "React/TypeScript"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Rust/WASM"
      assert_contains "$repo/.ceetrix/tech-lead/next-actions.md" "No immediate architecture action is required"
      ;;
    rich-auth-platform)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "apps/web"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "external OAuth"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Membership and role boundaries"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "normalizedFacts"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "deployment.environment"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "wrangler.toml.example"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "docs/self-hosting.md"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "docs/ops/staging.md"
      assert_contains "$repo/.ceetrix/tech-lead/evidence.json" "scripts/deploy-production.sh"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Which access-control risk should the next test harness protect first"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Which rollout risk should guide the next operational check"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "API-key or MCP session authentication"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "production, CLI-only, or legacy"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Which detected role, membership, or permission rule"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Which environment is the primary release target"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "Should the coach assume local-only use, private hosting, public hosting, or production service deployment"
      assert_not_contains "$repo/.ceetrix/tech-lead/questions.json" "What deployment model should this code assume"
      assert_not_contains "$output" "Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions"
      assert_not_contains "$output" "Should the coach assume local-only use, private hosting, public hosting, or production service deployment"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Web users authenticate through an external OAuth provider"
      ;;
    mac-package-deploy)
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Swift/macOS"
      assert_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "ScreencapMenuBar/Package.swift"
      assert_not_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "chrome_profile"
      assert_not_contains "$repo/.ceetrix/tech-lead/latest-assessment.md" "Code Cache"
      ;;
  esac

  echo "   output: $output"
done

echo "Claude brownfield e2e passed. Logs: $RUN_DIR"
