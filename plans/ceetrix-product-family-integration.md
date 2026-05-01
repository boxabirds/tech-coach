# Ceetrix Product Family Integration Plan

## Summary

Rebrand this repo from **Tech Coach** to **Ceetrix Tech Lead**, move its remote
to `git@github.com:ceetrixai/tech-lead.git`, and make `npx ceetrix` the umbrella
installer for Ceetrix tools.

Use Claude Code's native plugin marketplace/update mechanism as the authoritative
update path. Do not build a self-mutating MCP updater. The local MCP server may
later expose an advisory "update available" signal, but it should only tell the
user which command to run.

References:

- Claude Code discover plugins: <https://code.claude.com/docs/en/discover-plugins>
- Claude Code plugin marketplaces: <https://code.claude.com/docs/en/plugin-marketplaces>
- Claude Code plugins reference: <https://code.claude.com/docs/en/plugins-reference>

## Key Changes

- Rename visible product identity to **Ceetrix Tech Lead**:
  - repo: `ceetrixai/tech-lead`
  - plugin/package identity: `ceetrix-tech-lead`
  - MCP server name: `ceetrix-tech-lead`
  - primary local commands: `ceetrix-tech-lead`, `ceetrix-tech-lead-mcp`
  - keep `archcoach` aliases temporarily with deprecation messaging.

- Move project memory:
  - new default: `.ceetrix/tech-lead/memory.jsonl`
  - read legacy `.archcoach/memory.jsonl`
  - add migration behavior or clear migration instructions
  - update tests to cover legacy read compatibility.

- Rebrand existing Ceetrix backlog product:
  - existing `npx ceetrix` setup flow becomes **Ceetrix Backlog**
  - existing behavior remains available as `npx ceetrix backlog`
  - current no-arg `npx ceetrix` opens a product menu.

## Installer Design

- Extend the `ceetrix` npm package so:
  - `npx ceetrix` shows a menu:
    - Ceetrix Backlog
    - Ceetrix Tech Lead
  - `npx ceetrix backlog` runs the existing backlog installer.
  - `npx ceetrix tech-lead` installs/configures Ceetrix Tech Lead.
  - `npx ceetrix tech-lead --debug` verifies Claude, Bun/Node, plugin assets,
    and MCP launch.
  - local advisory install must not require external credentials.

- Tech Lead installation should:
  - add/update the Ceetrix Claude plugin marketplace
  - install `ceetrix-tech-lead`
  - validate `.claude-plugin/plugin.json`, `.mcp.json`, skill, hooks file, and
    executable launch
  - print exact recovery commands if Claude marketplace install/update fails.

- Updates:
  - primary: `claude plugin marketplace update ...` and `/plugin update`
  - optional npm-level prompt: `npx ceetrix tech-lead update` can run or print
    the Claude update command
  - no MCP self-update; MCP update checks are advisory only.

## Story Plan

- Create a new epic: **Ceetrix Distribution And Branding**.
- Add stories before lifecycle hook story 2:
  1. **Rebrand Tech Coach as Ceetrix Tech Lead and move repository**
     - update repo remote, README, package metadata, plugin manifest, MCP names,
       docs, tests, schema names where appropriate.
  2. **Install Ceetrix Tech Lead through the Ceetrix umbrella CLI**
     - extend `npx ceetrix` menu and `tech-lead` subcommand.
  3. **Rebrand existing Ceetrix setup as Ceetrix Backlog**
     - update CLI labels/docs while preserving existing install behavior.
  4. **Manage Tech Lead updates through Claude plugin marketplace**
     - add marketplace metadata, version policy, update command/help, and tests.
  5. Then resume **story 2** for lifecycle hooks.

## Test Plan

- Tech Lead repo:
  - full `bun test` and `bun run typecheck`
  - plugin validation tests expect `ceetrix-tech-lead`
  - MCP launcher smoke test exposes architecture tools under new server name
  - memory tests verify `.ceetrix/tech-lead` default and `.archcoach` legacy read.

- Ceetrix CLI:
  - unit tests for `npx ceetrix`, `backlog`, `tech-lead`, invalid product, and
    `--debug`
  - integration smoke test for Tech Lead installer command construction
  - no-credentials local advisory path
  - update command prints/runs Claude marketplace update path.

## Assumptions

- Use **Ceetrix Tech Lead** as the product name and `ceetrix-tech-lead` as the
  technical identifier.
- Use **Ceetrix Backlog** for the existing backlog/MCP product.
- Use marketplace-native updates as authority.
- The published `ceetrix` npm package currently points to
  `github.com/ceetrixai/ceetrix`; `ceetrixai/ceetrix-cli` was not reachable from
  this environment, so implementation should first confirm the true source repo
  for the npm package before editing the installer.
