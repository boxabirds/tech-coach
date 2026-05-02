# Policy v1 Evaluation

Story 28 validates that Ceetrix Tech Lead moves from generic advice to explicit, right-sized architecture actions.

## Coverage Model

- Unit policy tests cover independent per-concern maturity, planning axes, threshold classification, principle activation, structural pattern selection, do-not-add guidance, and intervention levels.
- Scenario fixtures cover single-turn host-facing guidance for quiet first work, repeated state ownership, local persistence, revisit-triggered substrate replacement, auth review, deployment, blast radius, public API contracts, operational evidence, and overengineering controls.
- Journey fixtures cover multi-turn timing: staying quiet early, recommending extraction only after repeated state pressure, inserting a repository boundary before substrate replacement, requiring decisions when prior assumptions expire, and preserving host-collected interview answers.
- Claude lifecycle E2E covers SessionStart, UserPromptSubmit, PostToolBatch, and Stop hook behavior with persisted audit records.
- `scripts/e2e-claude-brownfield.sh` covers the installed Claude plugin against representative brownfield repositories and rejects old ambiguous menu behavior, token overflow, missing persistence artifacts, and coarse generic questions.

## Expected Policy Behaviors

- Simple cosmetic changes produce `Continue` with note/silent-level behavior.
- Repeated React state and effects produce `Extract` only when state ownership evidence crosses the threshold.
- Persistence evidence produces `Insert boundary` before any substrate replacement.
- Prior local-only persistence decisions produce `Replace substrate` only when revisit conditions such as sharing or sync appear.
- Auth and public API thresholds produce review or boundary actions with decision-level intervention when evidence is high confidence.
- Runtime and deployment thresholds produce `Operationalize` rather than generic questioning.
- Broad changed-file spread produces `Run review`.
- Weak lexical evidence remains provisional and must not block.

## Commands

```sh
bun run typecheck
bun run test
scripts/e2e-claude-brownfield.sh
```
