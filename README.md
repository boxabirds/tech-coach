# Tech Coach

Tech Coach Alpha 1 is a local-first architecture coach for agentic software
development.

The practical version: install it into Claude Code or OpenAI Codex, point it at
a real project, and ask what architecture attention the current work needs.

Technical detail: Alpha 1 is version `0.1.0-alpha.1`. It packages a Claude Code
plugin surface and a local Codex integration through MCP, a skill file, and
optional hooks.

The central idea is that coding agents should not rely only on voluntary
reflection to notice when a codebase is becoming load-bearing. A coach should
observe lifecycle events, repo changes, architectural memory, and project
trajectory, then recommend the smallest structure needed to reduce entropy or
avoid new risk.

## Current Documents

- [Alpha 1 Install Guide](docs/alpha-1.md) is the short guide to share with
  friends trying Claude Code or Codex.
- [Spec v1](docs/spec-v1.md) defines the proposed Claude Code-first plugin
  architecture, portable kernel, lifecycle model, roadmap, and evaluation plan.
- [Manual Install Guides](docs/manual-install-guides.md) tracks local install
  state and future agent surfaces.
- [Architecture Coach Moot](docs/debates/foundations/architecture-coach-moot.md)
  is the fictionalized workshop transcript that motivated the design.

## Alpha 1 Quick Start

```sh
git clone https://github.com/boxabirds/tech-coach.git
cd tech-coach
bun install
bun test
bun run typecheck
```

For Claude Code:

```sh
claude --plugin-dir .
```

Then run:

```text
/tech-coach what should I do next?
```

For Codex, follow [the Codex install section](docs/alpha-1.md#codex-install).
Codex needs a local MCP config block and a copied skill file.

## Core Direction

The preferred shape is:

```text
portable architecture-coach kernel
+ SKILL.md guidance
+ MCP tools
+ deterministic CLI/bin
+ thin host-specific lifecycle hooks
+ optional specialist agents and monitors
```

Claude Code is the first priority because its plugin system can package skills,
agents, hooks, MCP servers, LSP configuration, background monitors, `bin/`
executables, default settings, and install-time user configuration.

The long-term goal is interoperability: the core protocol, schemas, maturity
model, assessment logic, and fixtures should survive host changes even when hook
configuration does not.

## Key Principle

The coach should not maximize architecture. It should improve architectural
timing:

```text
Introduce the smallest structure that protects the next likely change.
```

## Try The Claude Code Plugin

From this repo, run:

```sh
claude --plugin-dir .
```

The plugin exposes:

- `commands/tech-coach.md` for the `/tech-coach` Claude Code command
- `.mcp.json` for the local `tech-coach` MCP server
- `bin/archcoach` for CLI assessment
- `bin/archcoach-mcp` for MCP stdio launch
- `.claude-plugin/plugin.json` for Claude Code user configuration

The Claude Code plugin intentionally uses `commands/tech-coach.md`, not a
packaged `skills/` directory. Claude Code exposes packaged skills as namespaced
entries such as `/tech-coach:tech-coach`; the intended user entry is only
`/tech-coach`.

Safe defaults are local and advisory: no external credentials are required.
Hook configuration is present but inert in this story; lifecycle behavior is
introduced separately.

## Try Local Codex Support

Story 38 keeps Codex support local. It does not create or install a Codex
plugin. Codex reaches Tech Lead through the local MCP server and, optionally,
through command hooks in a trusted local Codex config layer.

Add the MCP server to `~/.codex/config.toml`, or to `.codex/config.toml` in a
trusted project:

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

Codex also supports lifecycle hooks behind a feature flag. The quiet default is
startup context, prompt context, and stop-gate checks. Do not wire Tech Lead to
`PostToolUse` by default; in Codex that fires after every tool call and can
repeat the same advice until a batching or debounce policy is added.

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

Codex MCP configuration is documented by OpenAI at
`https://developers.openai.com/codex/mcp`; hook configuration and event shapes
are documented at `https://developers.openai.com/codex/hooks`.

If MCP or hooks are unavailable, use the deterministic CLI fallback:

```sh
/Users/julian/expts/architecture-guide/bin/archcoach \
  capture --repo /path/to/target-repo --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/target-repo","userRequest":"what should I do next"}}
JSON
```

## Durable Assessment Packs

For brownfield work, use durable capture instead of a transient assessment:

```sh
archcoach capture --repo /path/to/target-repo --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/target-repo","userRequest":"Capture this repo before I change it"}}
JSON
```

Capture writes repo-local state under `.ceetrix/tech-lead/`:

- `tech-lead.db`: durable `bun:sqlite` source of truth for assessment runs, answers, confirmed decisions, diagnostics, telemetry, and artifact indexes
- `latest-assessment.md`: generated human-readable latest assessment report
- `latest-assessment.json`: generated machine-readable latest-run snapshot
- `questions.json`: generated open, answered, and skipped question index
- `evidence.json`: generated evidence and claims index used by the recommendation
- `next-actions.md`: generated focused action report
- `decisions.jsonl`: generated export of confirmed decisions
- `changes-since-last.md`: generated rerun delta report

The Markdown and JSON files are projections from the local database. They are
convenient to inspect and cite, but the database is the canonical local state
the coach updates between runs.

Read-only assessment remains available through `archcoach assess` and must not
create `.ceetrix/tech-lead/`.

## Test A Brownfield Repo

Run the local brownfield integration assessment from any repository:

```sh
cd /path/to/target-repo
/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh
```

Useful options:

```sh
/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh \
  --request "Assess this existing app before I add sharing" \
  --ceetrix-history /path/to/history.jsonl

/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh --json
/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh --capture
/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh \
  --code-intel-command /Users/julian/expts/architecture-guide/scripts/complexity-to-code-intel.ts
/Users/julian/expts/architecture-guide/scripts/test-brownfield.sh --claude
```

Run the full Claude Code plugin e2e against the three brownfield fixtures:

```sh
bun run test:claude-e2e
```

Run the claim-quality evaluation against the same repos and compare the output
to manual baselines:

```sh
bun run test:claims-e2e
```

Both Claude e2e commands reset each target repo's generated
`.ceetrix/tech-lead/` state before running, so results start from a clean
Tech Lead database instead of prior assessment history. Pass `--no-clean`
directly to `scripts/e2e-claude-brownfield.sh` only when deliberately inspecting
stateful follow-up behavior.

This loads the local Claude plugin from this checkout for
`~/expts/jp8`, `~/expts/claude-backlog`, and `~/expts/macscreencap`, runs:

```sh
claude \
  --plugin-dir /Users/julian/expts/architecture-guide \
  --allowedTools "mcp__plugin_tech-coach_tech-coach__*" \
  -p \
  "/tech-coach"
```

and asserts that the durable `.ceetrix/tech-lead/` assessment pack is created
with repo-specific architectural signals.

The MCP capture path returns a bounded assessment graph index by default. Hosts
can page through persisted assessment knowledge with
`architecture.query_assessment_graph` and inspect one claim, question, artifact,
or evidence item with `architecture.get_assessment_node`; full assessment detail
stays in `.ceetrix/tech-lead/` artifacts.

The claim-quality suite is documented in
`docs/evaluation/brownfield-claims.md`.

By default, the script is read-only for the target repo. It samples file layout,
changed files, git history, optional transcript history, existing architecture
memory, and optional Ceetrix history fixtures, then prints the coach's
recommended next architecture move and any questions that need user answers. Add
`--capture` to exercise the full persistence workflow and create
`.ceetrix/tech-lead/` artifacts in the target repo. By default it calls the
local `bin/archcoach-mcp` server, so it tests the MCP path rather than only the
kernel. Use `--direct` only when you deliberately want to bypass MCP while
debugging.

`scripts/complexity-to-code-intel.ts` is the adapter for the required Rust
tree-sitter complexity analyzer. It emits the generic
`tech-coach.code-intelligence.v1` schema. Brownfield capture requires this
structured code-intelligence producer; missing parser tooling is a configuration
or build error, not a heuristic fallback path.

## Test Persistence

Run the normal suite:

```sh
bun run typecheck
bun run test
```

Run the Bun-native SQLite persistence and public workflow suite:

```sh
bun run test:persistence
```
