import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUsageReview } from "../../kernel/src/usageEvents.js";
import { TechLeadPersistenceStore } from "./store.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("usage event persistence", () => {
  maybeIt("persists sanitized usage events and groups them by repository", () => {
    const repoA = tempRepo();
    const repoB = tempRepo();
    const storeA = new TechLeadPersistenceStore(repoA);
    const storeB = new TechLeadPersistenceStore(repoB);

    try {
      storeA.appendUsageEvent({
        id: "usage-a-capture",
        occurredAt: "2026-05-02T12:00:00.000Z",
        repoRoot: repoA,
        sessionId: "session-a",
        source: "mcp",
        engagementType: "baseline_capture",
        outcome: "engaged",
        metadata: {
          toolName: "architecture.capture_assessment",
          prompt: "please store this raw user prompt nowhere",
        },
      });
      storeA.appendUsageEvent({
        id: "usage-a-gap",
        occurredAt: "2026-05-02T12:01:00.000Z",
        repoRoot: repoA,
        sessionId: "session-a",
        source: "hook",
        engagementType: "passive_silence",
        outcome: "quiet",
        metadata: {
          architectureRelevant: true,
          baselineExists: true,
          missedEngagementCandidate: true,
        },
      });
      storeB.appendUsageEvent({
        id: "usage-b-query",
        occurredAt: "2026-05-02T12:02:00.000Z",
        repoRoot: repoB,
        sessionId: "session-b",
        source: "mcp",
        engagementType: "graph_query",
        outcome: "engaged",
        metadata: {
          toolName: "architecture.query_assessment_graph",
          apiKey: "sk-test-secret-1234567890",
        },
      });

      const repoAEvents = storeA.listUsageEvents({ repoRoot: repoA });
      const repoBEvents = storeB.listUsageEvents({ repoRoot: repoB });
      const review = buildUsageReview(repoAEvents);

      expect(repoAEvents).toHaveLength(2);
      expect(repoBEvents).toHaveLength(1);
      expect(JSON.stringify(repoAEvents)).not.toContain("raw user prompt");
      expect(JSON.stringify(repoBEvents)).not.toContain("sk-test-secret");
      expect(review.summary.byRepository).toEqual({ [repoA]: 2 });
      expect(review.notableGaps).toEqual([
        expect.objectContaining({ id: "usage-a-gap" }),
      ]);
    } finally {
      storeA.close();
      storeB.close();
      rmSync(repoA, { recursive: true, force: true });
      rmSync(repoB, { recursive: true, force: true });
    }
  });
});

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "tech-lead-usage-"));
}
