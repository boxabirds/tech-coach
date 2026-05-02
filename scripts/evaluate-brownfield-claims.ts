#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareBaselineArtifacts,
  loadManualBaselines,
} from "../packages/evaluation/src/claimComparator.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "packages/evaluation/fixtures/brownfield-claims/manual-baselines.json");
const args = new Set(process.argv.slice(2));

if (args.has("--run-claude")) {
  const e2eArgs = args.has("--no-clean") ? ["--no-clean"] : ["--clean"];
  const result = spawnSync(resolve(root, "scripts/e2e-claude-brownfield.sh"), e2eArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const baselines = loadManualBaselines(baselinePath);
const results = compareBaselineArtifacts(baselines);

for (const result of results) {
  process.stdout.write(`${result.passed ? "PASS" : "FAIL"} ${result.repository}\n`);
  for (const failure of result.failures) {
    process.stdout.write(`  - ${failure.category}: ${failure.message}\n`);
  }
}

const failed = results.filter((result) => !result.passed);
if (failed.length > 0) {
  process.stdout.write(`\nClaim evaluation failed for ${failed.length} repos.\n`);
  process.exit(1);
}

process.stdout.write("\nClaim evaluation passed for all repos.\n");
