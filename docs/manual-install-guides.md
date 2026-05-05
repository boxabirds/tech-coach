# Manual Install Guides

This file tracks what must be done to make Tech Coach available in each local
coding agent.

For friends trying the current release, use the shorter
[Alpha 1 guide](alpha-1.md). This file is the detailed local tracking document.

Plain English rule: an install is not complete just because the MCP server
exists. The agent also needs a visible way for the user to invoke or discover
Tech Coach, and a fallback path when MCP or hooks are unavailable.

Technical detail: the local checkout used by these guides is
`/Users/julian/expts/architecture-guide`. Alpha 1 is version
`0.1.0-alpha.1`.

## Install Surfaces

Each agent should be checked against these surfaces:

| Surface | What it means | Required for complete local install |
| --- | --- | --- |
| MCP server | The agent can call Tech Coach tools. | Yes |
| Discoverable skill, plugin, or extension | The user can find Tech Coach from the agent UI or command palette. | Yes |
| Lifecycle hooks | The agent can inject context or review stop/tool events automatically. | Preferred when the agent supports hooks |
| CLI fallback | The user can still run a deterministic assessment manually. | Yes |
| Plain-English guidance | Visible guidance starts with the practical point before technical detail. | Yes |

## Current Status

| Agent | Status on this machine | Main gap |
| --- | --- | --- |
| Claude Code | Installed and refreshed globally. | Existing running sessions need restart. |
| OpenAI Codex | Installed globally for MCP, quiet hooks, and skill discovery. | Existing running sessions need restart; public/plugin packaging remains separate work. |
| OpenCode | Not installed. | Need confirmed global MCP config and a discoverable plugin/command path. |
| Gemini CLI | Not installed. | Need MCP install, skill link, and hook migration/adapter decision. |
| pi.dev / `pi` | Not installed. | Need skill or extension packaging; MCP support is not confirmed from CLI help. |

## Claude Code

### Status

Installed globally at user scope.

Current local evidence:

- `claude plugin list` shows `tech-coach@ceetrix-tech-lead-local` enabled.
- The local marketplace is `/Users/julian/expts/tech-lead-marketplace`.
- The marketplace entry `tech-coach` points to this checkout by symlink.
- The cached plugin contains `commands/tech-coach.md`.
- The cached plugin does not contain a packaged `skills/` directory.
- The cached MCP launcher responds to `initialize` and `tools/list`.

### Install Or Refresh

Use this when the local plugin cache is stale:

```sh
claude plugin uninstall tech-coach@ceetrix-tech-lead-local \
  --scope user \
  --keep-data \
  --yes

claude plugin install tech-coach@ceetrix-tech-lead-local --scope user
```

If the marketplace is missing:

```sh
claude plugin marketplace add /Users/julian/expts/tech-lead-marketplace --scope user
claude plugin install tech-coach@ceetrix-tech-lead-local --scope user
```

### Verify

```sh
claude plugin list

test -f ~/.claude/plugins/cache/ceetrix-tech-lead-local/tech-coach/0.1.0-alpha.1/commands/tech-coach.md
test ! -e ~/.claude/plugins/cache/ceetrix-tech-lead-local/tech-coach/0.1.0-alpha.1/skills

tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/.ceetrix/tech-lead"
printf 'Action: Record decision\nReason: plain context test\n' \
  > "$tmpdir/.ceetrix/tech-lead/latest-assessment.md"
printf '{"cwd":"%s"}' "$tmpdir" \
  | ~/.claude/plugins/cache/ceetrix-tech-lead-local/tech-coach/0.1.0-alpha.1/bin/archcoach-hook SessionStart
rm -rf "$tmpdir"

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | ~/.claude/plugins/cache/ceetrix-tech-lead-local/tech-coach/0.1.0-alpha.1/bin/archcoach-mcp
```

Expected result:

- Plugin list shows `tech-coach` enabled.
- Only the root `/tech-coach` entry is expected in Claude Code.
- The cached plugin has `commands/tech-coach.md`.
- The cached plugin has no packaged `skills/` directory.
- Hook output starts with `Here is the saved project context to use before answering:`.
- MCP `tools/list` includes `architecture.capture_assessment`.

If Claude Code shows both `/tech-coach` and a namespaced duplicate such as
`/tech-coach:architecture-coach` or `/tech-coach:tech-coach`, the local plugin
cache still has an old skill folder. Refresh the plugin install, or remove only
the stale cached skill directory:

```sh
rm -rf ~/.claude/plugins/cache/ceetrix-tech-lead-local/tech-coach/0.1.0-alpha.1/skills
```

Restart Claude Code after changing plugin skills; the command list is cached per
session.

For Claude Code inside VS Code, a new Claude chat is not always enough. Run
`/reload-plugins` inside Claude Code, or run `Developer: Reload Window` from the
VS Code Command Palette.

### Notes

Claude caches plugin content by version. If the source changes but the plugin
version remains unchanged, use uninstall/install or bump the plugin version
before expecting Claude to refresh.

## OpenAI Codex

### Status

Installed globally for this machine.

Current local evidence:

- `~/.codex/config.toml` contains `mcp_servers.tech-coach`.
- `~/.codex/config.toml` enables `codex_hooks`.
- `~/.codex/config.toml` wires `SessionStart`, `UserPromptSubmit`, and `Stop`
  hooks to `bin/archcoach-codex-hook`.
- `~/.codex/skills/tech-coach/SKILL.md` exists and has `name: tech-coach`.
- `codex mcp list` shows `tech-coach` enabled.
- The Codex skill now says to pass the active project path explicitly as
  `repoRoot`; a bare `{}` MCP call can assess the Tech Coach checkout instead.
- `PostToolUse` is deliberately not part of the default install because the
  first Codex run showed it repeats the same advice after every tool call.

### Install Or Refresh

Add this global MCP block to `~/.codex/config.toml`:

```toml
[mcp_servers.tech-coach]
command = "/Users/julian/expts/architecture-guide/bin/archcoach-mcp"
cwd = "/Users/julian/expts/architecture-guide"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true

[mcp_servers.tech-coach.env]
ARCHCOACH_MODE = "advisory"
```

Add Codex hooks to the same file:

```toml
[features]
codex_hooks = true

[[hooks.SessionStart]]
matcher = "startup|resume|clear"
[[hooks.SessionStart.hooks]]
type = "command"
command = "/Users/julian/expts/architecture-guide/bin/archcoach-codex-hook"
timeout = 30
statusMessage = "Loading Tech Lead context"

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "/Users/julian/expts/architecture-guide/bin/archcoach-codex-hook"
timeout = 30

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "/Users/julian/expts/architecture-guide/bin/archcoach-codex-hook"
timeout = 30
```

Install or refresh the Codex skill from the source-controlled template:

```sh
mkdir -p ~/.codex/skills/tech-coach
cp /Users/julian/expts/architecture-guide/packages/codex-hooks/templates/tech-coach/SKILL.md \
  ~/.codex/skills/tech-coach/SKILL.md
```

### Verify

```sh
python3 - <<'PY'
import tomllib
from pathlib import Path
with Path.home().joinpath(".codex/config.toml").open("rb") as f:
    data = tomllib.load(f)
print(data["mcp_servers"]["tech-coach"]["command"])
print(data.get("features", {}).get("codex_hooks"))
print(sorted(data.get("hooks", {}).keys()))
PY

codex mcp list

grep -E "name: tech-coach|Tech Lead|plain English" ~/.codex/skills/tech-coach/SKILL.md

printf '{"cwd":"/Users/julian/expts/architecture-guide","stop_hook_active":true}' \
  | /Users/julian/expts/architecture-guide/bin/archcoach-codex-hook Stop
```

Expected result:

- `codex mcp list` shows `tech-coach` enabled.
- `$tec` in a restarted Codex session shows `tech-coach`.
- The hook list does not include `PostToolUse` for Tech Coach by default.
- Stop hook prints `{ "continue": true }`.

### Notes

Codex sessions need restart after adding or changing skills. MCP and hook
configuration also may not reload in an existing session.

Current packaging gap: the Codex skill is installed manually from the local
source template under `packages/codex-hooks/templates/tech-coach`. It is kept
outside the Claude plugin `skills/` path so Claude Code does not expose it as a
namespaced `/tech-coach:codex-tech-coach` command.

## OpenCode

### Status

Not installed.

Current local evidence:

- `opencode` is present at `/opt/homebrew/bin/opencode`.
- `opencode mcp list` currently shows only `pencil`.
- `opencode mcp add` exists, but the exact noninteractive argument shape still
  needs confirmation.
- `opencode plugin <module>` installs npm modules, so a proper OpenCode plugin
  would require packaging work.

### Required Work

1. Add Tech Coach as a global OpenCode MCP server.
2. Decide the discoverable surface:
   - MCP-only plus documentation, or
   - npm-packaged OpenCode plugin.
3. Decide whether OpenCode supports lifecycle hooks comparable to Claude/Codex.
4. Verify Tech Coach tools can be called from OpenCode.
5. Add a CLI fallback note for users.

### Candidate Commands

These are not yet verified:

```sh
opencode mcp add tech-coach /Users/julian/expts/architecture-guide/bin/archcoach-mcp
opencode mcp list
```

### Verify

```sh
opencode mcp list
```

Expected result after install:

- `tech-coach` appears and connects.
- The user has a clear way to discover when to use it.

## Gemini CLI

### Status

Not installed.

Current local evidence:

- `gemini` is present.
- `gemini mcp`, `gemini skills`, and `gemini hooks` commands exist.
- `gemini skills list --all` does not show `tech-coach`.
- `gemini mcp list` does not show `tech-coach`.

### Required Work

1. Add Tech Coach MCP globally.
2. Link or install a Gemini-visible Tech Coach skill.
3. Decide whether to migrate Claude hooks or write Gemini-specific hook behavior.
4. Verify Gemini can discover the skill and call the MCP server.

### Candidate Commands

```sh
gemini mcp add tech-coach /Users/julian/expts/architecture-guide/bin/archcoach-mcp
gemini skills link /Users/julian/.codex/skills/tech-coach
gemini skills enable tech-coach
```

Hook migration is available, but not yet verified for Tech Coach:

```sh
gemini hooks migrate
```

### Verify

```sh
gemini mcp list
gemini skills list --all | grep -E "tech-coach|Tech Lead"
```

Expected result after install:

- MCP list shows `tech-coach`.
- Skill list shows `tech-coach` enabled.

## pi.dev / `pi`

### Status

Not installed.

Current local evidence:

- `pi` is present.
- `pi list` reports no packages installed.
- `pi --help` supports `--skill <path>`.
- `pi --help` does not show a direct MCP command.
- `pi install <source>` installs extension packages, which may be the right
  long-term packaging route.

### Required Work

1. Confirm whether `pi` can use MCP directly, or whether Tech Coach must be
   exposed through a `pi` extension or CLI fallback.
2. Provide a discoverable skill or extension.
3. Add a stable invocation path for local assessment.
4. Verify the skill/extension appears in `pi list` or can be loaded globally.

### Candidate Commands

Short-term skill-only use:

```sh
pi --skill /Users/julian/.codex/skills/tech-coach
```

Long-term package route, not yet built:

```sh
pi install ./path-to-tech-coach-pi-extension
pi list
```

### Verify

```sh
pi list
pi --skill /Users/julian/.codex/skills/tech-coach -p "Use Tech Coach to explain how to review this repo"
```

Expected result after install:

- `pi` loads Tech Coach instructions.
- The user has a repeatable package or global configuration path, not just a
  one-off command-line flag.

## Shared CLI Fallback

Every agent can fall back to the local CLI:

```sh
/Users/julian/expts/architecture-guide/bin/archcoach \
  capture --repo /path/to/repo --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/repo","userRequest":"what should I do next"}}
JSON

/Users/julian/expts/architecture-guide/bin/archcoach \
  assess --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/repo","userRequest":"what should I do next"}}
JSON
```

The outer `event` object is required. Passing a raw event object causes the CLI
to report missing `host` and `event` fields. MCP remains the preferred path
because it preserves structured questions, answers, and local assessment memory.

## Next Actions

1. Verify Codex skill discovery after restarting Codex and typing `$tec`.
2. Install and verify Gemini CLI MCP plus skill link.
3. Research and install OpenCode MCP with a discoverable command or plugin.
4. Decide whether `pi` needs an extension package or skill-only support is
   sufficient.
5. Keep this file updated whenever an install state changes.
