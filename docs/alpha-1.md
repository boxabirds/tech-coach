# Tech Coach Alpha 1

Alpha 1 is a local-first release for trying Tech Coach with Claude Code and
OpenAI Codex.

The practical setup is simple: clone this repo, install dependencies, then
point your coding agent at the local checkout. Nothing talks to an external
Tech Coach service by default.

Technical detail: Claude Code uses the repo as a local plugin. Codex uses the
same repo through a local MCP server, a local skill file, and optional local
hooks.

## Status

- Release name: Alpha 1
- Version: `0.1.0-alpha.1`
- Supported now: Claude Code and OpenAI Codex
- Local runtime: Bun source execution, with optional built `dist/` artifacts
- Default mode: advisory
- Default storage: project-local `.ceetrix/tech-lead/`

## Before You Start

Install these first:

```sh
git --version
bun --version
claude --version    # for Claude Code users
codex --version     # for Codex users
```

Clone and check the repo:

```sh
git clone https://github.com/boxabirds/tech-coach.git
cd tech-coach
bun install
bun test
bun run typecheck
claude plugin validate .  # Claude Code users only
```

If `bun` is not installed, install it first from <https://bun.sh/>.

## Claude Code Install

### Quick Trial

Use this when you want to try Tech Coach without changing your global Claude
Code plugin setup:

```sh
export TECH_COACH_HOME="$PWD"
cd /path/to/project-you-want-to-review
claude --plugin-dir "$TECH_COACH_HOME"
```

Inside Claude Code, run:

```text
/tech-coach what should I do next?
```

Expected result: Claude Code should show one Tech Coach command, `/tech-coach`.
It should not show namespaced duplicates like `/tech-coach:tech-coach`.

### User Install

Use this when you want `/tech-coach` available in new Claude Code sessions.
This creates a small local marketplace that points at your cloned checkout.

```sh
export TECH_COACH_HOME="/path/to/tech-coach"
export TECH_COACH_MARKETPLACE="$HOME/.tech-coach-alpha-marketplace"

mkdir -p "$TECH_COACH_MARKETPLACE/.claude-plugin"
ln -sfn "$TECH_COACH_HOME" "$TECH_COACH_MARKETPLACE/tech-coach"

cat > "$TECH_COACH_MARKETPLACE/.claude-plugin/marketplace.json" <<'JSON'
{
  "name": "tech-coach-alpha-local",
  "owner": {
    "name": "Tech Coach Alpha"
  },
  "plugins": [
    {
      "name": "tech-coach",
      "source": "./tech-coach",
      "description": "Architecture coaching for Claude Code with local MCP tools, a deterministic CLI, and host-mediated interview guidance.",
      "version": "0.1.0-alpha.1"
    }
  ]
}
JSON

claude plugin marketplace add "$TECH_COACH_MARKETPLACE" --scope user
claude plugin install tech-coach@tech-coach-alpha-local --scope user
```

Verify:

```sh
claude plugin list
claude plugin validate "$TECH_COACH_HOME"
```

Restart Claude Code after installing or updating the plugin. Claude Code caches
plugin commands per session.

If you are using Claude Code in VS Code, a new Claude chat is not always enough.
Run `/reload-plugins` in Claude Code, or run `Developer: Reload Window` from the
VS Code Command Palette. If the plugin was updated through a local marketplace,
refresh the marketplace and plugin first:

```sh
claude plugin marketplace update tech-coach-alpha-local
claude plugin update tech-coach@tech-coach-alpha-local --scope user
```

## Codex Install

Codex needs two things:

1. The local MCP server, so Codex can call Tech Coach tools.
2. The local skill file, so Codex can discover when to use Tech Coach.

Add this to `~/.codex/config.toml`. If you already have a
`mcp_servers.tech-coach` block, edit the existing block instead of adding a
second one.

```toml
[mcp_servers.tech-coach]
command = "/path/to/tech-coach/bin/archcoach-mcp"
cwd = "/path/to/tech-coach"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true

[mcp_servers.tech-coach.env]
ARCHCOACH_MODE = "advisory"
```

Optional hooks:

```toml
[features]
codex_hooks = true

[[hooks.SessionStart]]
matcher = "startup|resume|clear"
[[hooks.SessionStart.hooks]]
type = "command"
command = "/path/to/tech-coach/bin/archcoach-codex-hook"
timeout = 30
statusMessage = "Loading Tech Coach context"

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "/path/to/tech-coach/bin/archcoach-codex-hook"
timeout = 30

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "/path/to/tech-coach/bin/archcoach-codex-hook"
timeout = 30
```

Install the Codex skill:

```sh
export TECH_COACH_HOME="/path/to/tech-coach"
mkdir -p "$HOME/.codex/skills/tech-coach"
cp "$TECH_COACH_HOME/packages/codex-hooks/templates/tech-coach/SKILL.md" \
  "$HOME/.codex/skills/tech-coach/SKILL.md"
```

Verify:

```sh
codex mcp list
grep -E "name: tech-coach|Definition-first rule" \
  "$HOME/.codex/skills/tech-coach/SKILL.md"
printf '{"cwd":"%s","stop_hook_active":true}' "$TECH_COACH_HOME" \
  | "$TECH_COACH_HOME/bin/archcoach-codex-hook" Stop
```

Restart Codex after changing MCP, hook, or skill configuration. In a restarted
Codex session, `$tec` should show `tech-coach`.

## Manual CLI Fallback

If plugin or MCP setup is not working, run the coach directly:

```sh
/path/to/tech-coach/bin/archcoach capture \
  --repo /path/to/project-you-want-to-review \
  --output text <<'JSON'
{"event":{"host":"manual","event":"UserPromptSubmit","cwd":"/path/to/project-you-want-to-review","userRequest":"what should I do next"}}
JSON
```

This writes local assessment state under:

```text
/path/to/project-you-want-to-review/.ceetrix/tech-lead/
```

## What To Test

Ask Tech Coach to review an existing repo, not an empty directory, if you want
meaningful architecture guidance:

```text
/tech-coach what should I do next?
```

Useful feedback to send back:

- The agent and version: Claude Code or Codex
- Whether install worked
- Whether `/tech-coach` or `$tec` found the coach
- The first Tech Coach response
- Any advice that felt fabricated, stale, too technical, or too noisy

## Known Alpha 1 Limits

- The release is local-first. There is no hosted Tech Coach service.
- Claude Code has a local plugin path. Codex currently uses local MCP plus a
  copied skill template, not a packaged Codex plugin.
- OpenCode, Gemini, and pi.dev are not supported in Alpha 1.
- Existing agent sessions usually need restart after install.
- The coach can still be too eager or too technical. The intended style is:
  plain English first, and technical terms only after they are defined.
