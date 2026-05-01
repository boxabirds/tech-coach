---
description: Use when making or reviewing code changes that may affect architecture, persistence, state ownership, deployment, API contracts, security, testing posture, or project structure. Use this skill when Tech Coach MCP tools return interview questions or decision-required signposts.
---

# Architecture Coach

Use the Tech Coach MCP tools as the deterministic architecture boundary. The coach is advisory unless configured otherwise by the enabled Claude Code plugin.

## Default Behavior

Do not start by offering a menu of assessment modes.

When the user invokes this skill without a specific instruction, assume they mean:

> Look at this repository, create the durable Tech Lead assessment pack, and tell me what I should do next.

Then call `architecture.capture_assessment` with the active project `cwd`.

After the tool returns, respond with:

1. The recommended next move in plain English.
2. The 1-3 most important reasons from the evidence.
3. Any question that blocks confidence, asked directly.
4. The artifact paths only as supporting detail.

Prior decision records are optional context. A repository with no prior Tech Lead
decisions is a normal first-run state. Never describe the assessment as empty,
invalid, weak, or incomplete because there are no prior decisions. If confidence
is limited, attribute that to missing current repo evidence or unanswered
questions, not to the absence of memory.

Do not say "brownfield assessment", "change assessment", "structure review", or "horizon scan" to the user unless they used those words first or explicitly ask what modes exist. Those are implementation/tooling distinctions, not useful first-run choices.

Good first response shape:

```text
I’ll review the current repo and save the assessment so we can build on it.
```

Then run the capture tool. Do not wait for the user to choose a mode.

## Tool Selection

Call `architecture.capture_assessment` for brownfield reviews or repository assessments where the user expects a durable record. This writes `.ceetrix/tech-lead/tech-lead.db` plus human-readable artifacts, then returns paths Claude can cite.

Call `architecture.assess_change` only when the user clearly asks for a quick, read-only check of a specific pending change and no repository artifacts should be created.

Use either path when a change may affect:

- persistent storage, database shape, files used as data stores, or migrations
- authentication, authorization, permissions, privacy, or compliance
- deployment, hosting, public access, operational reliability, or rollback
- public APIs, shared contracts, background jobs, or cross-package boundaries
- repeated feature additions that make state ownership, component shape, or tests unclear
- brownfield baselines where existing code, history, or prior decisions should shape the next move

Existing code and repository signals are enough to produce a valid first
assessment. Prior decisions improve replay and context, but they are not
required.

Use `architecture.review_structure` or `architecture.horizon_scan` only when the user specifically asks for that narrower read-only analysis. Use `architecture.record_decision` only after the user has explicitly confirmed a durable architecture decision. For Tech Lead persistence, pass `confirmed: true` so the decision is recorded in the repo-local assessment pack.

## Durable Brownfield Workflow

For brownfield repository review:

1. Call `architecture.capture_assessment` with the active project `cwd` or `repoRoot`.
2. Tell the user the next architectural move, not the tool mode.
3. Mention whether the assessment was saved.
4. Point to the returned `latest-assessment.md`, `questions.json`, and `next-actions.md` after the recommendation.
5. Ask open questions from the persisted `questions.json` state.
6. Persist each answer with `architecture.answer_question`.
7. Persist durable decisions only after explicit user confirmation with `architecture.record_decision` and `confirmed: true`.
8. On rerun, treat previously answered questions and confirmed decisions as persisted context, but surface conflicts or changed evidence.

If capture fails, say no durable pack was created and include the diagnostic. Do not imply the assessment exists in the repository unless artifact paths were returned.

## Host-Mediated Interview Workflow

When coach output includes `interview.hostMediated: true` and one or more questions:

1. Ask the user the questions in normal conversation.
2. Preserve each `question.id` exactly.
3. Briefly explain why the answer matters and which architecture assumption it affects.
4. Do not answer the questions yourself.
5. Do not fabricate missing preferences, constraints, compliance needs, or deployment intent.
6. Convert user responses into `BaselineAnswer[]`.
7. For transient read-only assessments, call `architecture.apply_interview_answers` with the original `baseline`, the original `questions`, and the host-collected `answers`.
8. For durable brownfield assessments, call `architecture.answer_question` for each host-collected answer so the repo-local pack updates.
9. Continue dependent work only after the answers are applied, or clearly mark unresolved assumptions if the user skips them.

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

If MCP is unavailable, use the `archcoach` executable from the plugin `bin/` directory.

```sh
archcoach assess --output text < event.json
archcoach capture --repo . --output text < event.json
```

The CLI is a fallback; prefer MCP tools when available because they preserve structured interview and memory contracts.
