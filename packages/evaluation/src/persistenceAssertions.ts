import { existsSync, readFileSync, statSync } from "node:fs";
import type { CaptureAssessmentResult } from "../../persistence/src/index.js";

export function assertDurableAssessmentPack(result: CaptureAssessmentResult): void {
  if (!result.durableRecordCreated) {
    throw new Error(`Expected durable assessment pack, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  }
  if (!result.artifactPaths) {
    throw new Error("Expected artifact paths in capture result.");
  }
  if (!existsSync(result.storePath) || statSync(result.storePath).size === 0) {
    throw new Error(`Expected SQLite store at ${result.storePath}.`);
  }
  for (const path of Object.values(result.artifactPaths)) {
    if (!existsSync(path)) {
      throw new Error(`Expected artifact file ${path}.`);
    }
  }
  const latest = JSON.parse(readFileSync(result.artifactPaths.latestAssessmentJson, "utf8")) as {
    run?: { runId?: string };
  };
  if (latest.run?.runId !== result.runId) {
    throw new Error(`latest-assessment.json did not match run ${result.runId}.`);
  }
}

export function readArtifactJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
