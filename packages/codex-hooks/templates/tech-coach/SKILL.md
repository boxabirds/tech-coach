---
name: tech-coach
description: Use when making or reviewing code changes that may affect architecture, persistence, state ownership, deployment, API contracts, security, testing posture, project structure, or when the user asks for Tech Lead or Tech Coach guidance. This skill uses the local Tech Lead MCP server and keeps guidance in plain English before technical details.
metadata:
  short-description: Tech Lead architecture guidance
---

# Tech Coach

Use this skill when the user asks for Tech Lead, Tech Coach, architecture
guidance, or when a planned code change may affect structure, persistence,
state ownership, deployment, API contracts, security, testing posture, or
project boundaries.

## Default Style

Use plain English first. Start with what the guidance means for the user and
the project. If you need to name technical concepts, tool names, graph nodes,
ids, contracts, risk categories, package boundaries, or implementation details,
first explain the practical point in nontechnical language, then add the
technical detail as support.

Definition-first rule: technical jargon is allowed only after it has been
defined in plain English. This applies to every domain, not only any example.
Before using a specialized term, acronym, protocol name, tool category, or
architecture pattern, define it in the same sentence or in the immediately
preceding sentence. Do not use acronym-only lists.

Bad:

- Technical detail: CRDT / OT / presence territory.
- The contract risk is at the JS/WASM boundary.

Good:

- Technical detail: a conflict-free replicated data type, or CRDT, is one way
  to merge edits made in different browsers.
- The risky part is the handoff between browser code and compiled Rust code.
  Technical detail: that handoff is the JavaScript to WebAssembly boundary.

Do not start by offering a menu of modes. Do not show raw question ids or graph
node ids in normal user-facing prose. Keep those as internal handles for tool
calls.

## Active Repository Rule

Always target the repository the user is working in, not the Tech Coach
installation checkout.

Before calling any Tech Coach tool, identify the active project path from the
current Codex working directory. Pass that path explicitly as `repoRoot`. Never
call `architecture.capture_assessment` with `{}`.

If a tool result stores artifacts outside the active project, stop using that
result. Explain briefly that the wrong project was assessed, rerun the tool with
the active `repoRoot`, and only then give advice.

Technical detail: the MCP server may run with its own `cwd`, such as
`/Users/julian/expts/architecture-guide`. That is the tool installation path,
not necessarily the user's project.

## Normal Workflow

If the user asks for a repository review or invokes Tech Lead without a more
specific request, review the current repo and save an assessment we can build
on.

Technical detail: call the `tech-coach` MCP tool
`architecture.capture_assessment` with this shape:

```json
{
  "repoRoot": "<active project path>",
  "event": {
    "host": "codex",
    "event": "UserPromptSubmit",
    "cwd": "<active project path>",
    "userRequest": "<user request>"
  }
}
```

After the tool returns:

1. Confirm the saved artifact path is under the active project.
2. Say what was found in plain English.
3. Mention the one to three most important observations.
4. Ask immediate questions only when the current work depends on the answers.
5. Put artifact paths and tool details after the plain-English explanation.

## Follow-Up Architecture Questions

When the user asks a normal architecture follow-up, first use saved Tech Lead
context if it exists. Give a grounded recommendation before asking follow-up
questions.

Technical detail: use `architecture.query_assessment_graph` or
`architecture.get_assessment_node` with the active project `repoRoot` to load
relevant claims and evidence. If no baseline exists yet, call
`architecture.capture_assessment` first with the explicit `repoRoot`.

Ask at most two follow-up questions, and only if the answers would materially
change the recommendation.

## Questions And Answers

If Tech Lead returns questions, ask them conversationally. Explain why the
answer matters before any technical detail.

Do not answer the questions yourself. Do not invent missing preferences,
constraints, compliance needs, or deployment intent.

Technical detail: preserve `question.id` internally for MCP calls. Apply
answers through `architecture.answer_question` for durable assessments, or
`architecture.apply_interview_answers` for transient read-only assessments.

## CLI Fallback

If the MCP server is unavailable, use the local CLI from the installed checkout.
The capture command expects an outer `event` object, not a raw event object.

```sh
/Users/julian/expts/architecture-guide/bin/archcoach capture \
  --repo /path/to/active-project \
  --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/active-project","userRequest":"what should I do next"}}
JSON
```

For a read-only check:

```sh
/Users/julian/expts/architecture-guide/bin/archcoach assess \
  --output text <<'JSON'
{"event":{"host":"codex","event":"UserPromptSubmit","cwd":"/path/to/active-project","userRequest":"what should I do next"}}
JSON
```

Prefer MCP tools when available because they preserve structured interview and
memory contracts.
