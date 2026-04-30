# Tech Coach

Tech Coach is a design exploration for an architecture-coaching plugin for
agentic software development.

The central idea is that coding agents should not rely only on voluntary
reflection to notice when a codebase is becoming load-bearing. A coach should
observe lifecycle events, repo changes, architectural memory, and project
trajectory, then recommend the smallest structure needed to reduce entropy or
avoid new risk.

## Current Documents

- [Spec v1](docs/spec-v1.md) defines the proposed Claude Code-first plugin
  architecture, portable kernel, lifecycle model, roadmap, and evaluation plan.
- [Architecture Coach Moot](docs/debates/foundations/architecture-coach-moot.md)
  is the fictionalized workshop transcript that motivated the design.

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

