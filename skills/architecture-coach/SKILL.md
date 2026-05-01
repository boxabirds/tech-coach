---
description: Use when making or reviewing code changes that may affect architecture, persistence, state ownership, deployment, API contracts, security, testing posture, or project structure. Use this skill when Tech Coach MCP tools return interview questions or decision-required signposts.
---

# Architecture Coach

Use the Tech Coach MCP tools as the deterministic architecture boundary. The coach is advisory unless configured otherwise by the enabled Claude Code plugin.

## When To Call The Coach

Call `architecture.assess_change` when a change may affect:

- persistent storage, database shape, files used as data stores, or migrations
- authentication, authorization, permissions, privacy, or compliance
- deployment, hosting, public access, operational reliability, or rollback
- public APIs, shared contracts, background jobs, or cross-package boundaries
- repeated feature additions that make state ownership, component shape, or tests unclear
- brownfield baselines where existing code, history, or prior decisions should shape the next move

Use `architecture.review_structure` for a deeper read-only structure review and `architecture.horizon_scan` for planning-horizon pressure. Use `architecture.record_decision` only after the user has explicitly confirmed a durable architecture decision.

## Host-Mediated Interview Workflow

When coach output includes `interview.hostMediated: true` and one or more questions:

1. Ask the user the questions in normal conversation.
2. Preserve each `question.id` exactly.
3. Briefly explain why the answer matters and which architecture assumption it affects.
4. Do not answer the questions yourself.
5. Do not fabricate missing preferences, constraints, compliance needs, or deployment intent.
6. Convert user responses into `BaselineAnswer[]`.
7. Call `architecture.apply_interview_answers` with the original `baseline`, the original `questions`, and the host-collected `answers`.
8. Continue dependent work only after the answers are applied, or clearly mark unresolved assumptions if the user skips them.

Use this answer shape:

```json
[
  {
    "questionId": "question-id-from-coach",
    "action": "confirm",
    "value": "User's answer in their words"
  }
]
```

Allowed `action` values are `confirm`, `correct`, `mark_temporary`, and `skip`.

## Question Style

If a question includes `interactionGuidance`, use it to choose language:

- `technical_choice`: ask direct technical tradeoff questions.
- `business_outcome`: ask what user or business outcome the architecture must support.
- `risk_compliance`: ask about privacy, security, retention, access-control, audit, or compliance obligations.
- `guided_default`: offer the coach's reversible default and ask whether to proceed.

Do not visibly label the operator as novice, expert, naive, or sophisticated. The goal is to ask in language that fits the project history and current request.

## CLI Fallback

If MCP is unavailable, use the `archcoach` executable from the plugin `bin/` directory for read-only assessment:

```sh
archcoach assess --output text < event.json
```

The CLI is a fallback; prefer MCP tools when available because they preserve structured interview and memory contracts.
