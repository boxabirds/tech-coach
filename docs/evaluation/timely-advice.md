# Timely Advice Evaluation

Story 31 evaluates whether Ceetrix Tech Lead gives useful architecture advice
at the right time. The target is not plausible-sounding prose. The target is
evidence-based movement: stay quiet when structure would be premature, name or
extract when complexity is local, insert a boundary before a substrate decision,
and force an explicit decision when uncertainty or irreversibility makes silent
progress risky.

This document extends the v1 strategy in
[docs/spec-v1.md](../spec-v1.md), especially the separation between signal
capture and action, per-concern maturity, lifecycle coaching, and the action
vocabulary.

## Evaluation Layers

The suite is MECE across the main ways the coach can fail.

| Layer | What It Proves | Main Files |
| --- | --- | --- |
| Fixture judgment | Deterministic signals map to the expected concern, threshold, and action without overbuilding | `fixtures/cases/scenarios.ts`, `packages/evaluation/src/runner.ts` |
| CLI and MCP contracts | Host tools can ask for assessment data without token overflow or ambiguous result shapes | `packages/evaluation/src/claimComparator.ts`, MCP graph tests |
| Hook integration | Claude lifecycle events are captured and persisted at SessionStart, UserPromptSubmit, PostToolBatch, and Stop | `packages/evaluation/src/lifecycleE2E.test.ts` |
| Agent behavior | Host-agent operations remain right-sized after coach advice | `packages/evaluation/src/agentBehavior.ts` |
| Multi-turn journeys | Advice timing changes correctly as a project evolves across turns and memory | `fixtures/journeys/journeys.ts`, `packages/evaluation/src/journeyRunner.ts` |
| Portability | Equivalent non-Claude bundles produce equivalent kernel decisions | `fixtures/portability/equivalent-assessment.json` |
| Real repo regression | Brownfield output matches manual baselines for representative repositories | `packages/evaluation/fixtures/brownfield-claims/manual-baselines.json` |

## Failure Classification

Failures are classified by where entropy entered the system.

| Category | Meaning | Typical Fix |
| --- | --- | --- |
| `fixture_contract_failure` | The test case itself is malformed or contradictory | Fix the fixture before changing policy |
| `extraction_failure` | The coach did not find or preserve relevant repository evidence | Improve inventory, config, code, text, or graph extraction |
| `policy_failure` | Evidence was available but the coach chose the wrong threshold or action | Improve maturity, pressure, principle, or action mapping |
| `interview_failure` | The coach asked a current-state question evidence should answer, or missed a future-intent question | Improve residual unknown planning |
| `memory_failure` | Accepted decisions, debt, or prior assessment state were not carried forward | Improve persistence or memory merge behavior |
| `host_rendering_failure` | The host could not correlate, page, or present the coach result correctly | Improve MCP/CLI response contract or hook payload handling |

## What Counts As Passing

The coach must pass all of these behavioral checks:

- It stays quiet for low-risk cosmetic or first-feature work.
- It recommends the smallest useful structure when evidence crosses a local
  complexity threshold.
- It gives concrete action and a "do not add yet" boundary.
- It does not ask the user questions answered by repository evidence.
- It asks only residual future-intent questions, and explains why the answer
  changes the next move.
- It preserves accepted architecture debt and revisits it only when complexity
  pressure changes.
- It keeps host-agent implementation behavior proportional to the advice.
- It exposes large knowledge through navigable MCP graph pages, not one large
  undifferentiated response.

## Commands

Run deterministic unit and integration coverage:

```sh
bun run typecheck
bun test
```

Run the Claude plugin lifecycle and brownfield checks:

```sh
bun run test:claude-e2e
bun run test:claims-e2e
```

`bun run test:claims-e2e` resets the `.ceetrix/tech-lead/` directory in the
configured target repositories unless it is called with `--no-clean` through
the underlying script.

## Interpreting Results

A failing test should be triaged by category before changing code:

- Extraction failures mean the coach does not know enough.
- Policy failures mean it knows enough but chose poorly.
- Interview failures mean it is using the user to compensate for weak discovery
  or weak future-intent planning.
- Host rendering failures mean the kernel result may be valid, but the host
  cannot reliably consume it.

This distinction matters because the same bad user experience can have
different causes. A broad authentication question, for example, may come from
missing code evidence, an over-broad residual unknown, or a host response that
hid the relevant graph page.
