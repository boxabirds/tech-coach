# Brownfield Claim Evaluation

The claim evaluation suite compares Tech Lead output against manual expectations
for representative brownfield repositories. These baselines are human
expectations, not snapshots to auto-refresh after a weak run.

## Repositories

- `jp8`: React/TypeScript surface with Rust/WASM or native runtime boundary.
- `claude-backlog`: Cloudflare/React/workers system with GitHub OAuth,
  server-side sessions, API-key/MCP session paths, relational/D1 migrations,
  and deployment boundaries.
- `macscreencap`: Swift/macOS package with signing, release, and test surfaces.

## Commands

Run the full Claude/plugin path and compare the resulting artifacts:

```sh
bun run test:claims-e2e
```

This resets each target repository's `.ceetrix/tech-lead/` directory before
running Claude, so the result proves discovery from a blank Tech Lead database.

Run only the comparator against existing `.ceetrix/tech-lead/` artifacts:

```sh
bun scripts/evaluate-brownfield-claims.ts
```

To deliberately reuse existing Tech Lead state, run:

```sh
bun scripts/evaluate-brownfield-claims.ts --run-claude --no-clean
```

## Failure Categories

- `missing_claim`: the coach missed an obvious manual-baseline claim.
- `missing_evidence`: the claim exists but lacks expected corroborating evidence.
- `missing_question`: a useful residual question did not appear.
- `forbidden_question`: a broad question returned even though evidence answers it.
- `forbidden_evidence`: noisy/generated evidence supports a claim.
- `artifact_missing`: the repository has not produced the required assessment pack.

## Updating Baselines

Update `packages/evaluation/fixtures/brownfield-claims/manual-baselines.json`
only when the manual understanding of a repository changes. Do not update a
baseline merely because the coach produced weaker output.
