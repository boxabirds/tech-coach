import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleClaudeHookEvent,
  recordUsageEvent,
} from "../../claude-hooks/src/hookAdapter.js";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { thresholdEvent } from "../../mcp/src/__fixtures__/inputs.js";
import { invokeArchitectureTool } from "../../mcp/src/tools.js";
import { TechLeadPersistenceStore } from "../../persistence/src/store.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("usage logging E2E", () => {
  maybeIt("reviews a simulated Claude session without exposing prompts", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-usage-e2e-"));
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"), "# baseline\n");

    try {
      const capture = invokeArchitectureTool("architecture.capture_assessment", {
        repoRoot: repo,
        event: { ...thresholdEvent, cwd: repo, userRequest: "baseline capture raw prompt" },
      });
      expect(capture.ok).toBe(true);

      handleClaudeHookEvent(
        {
          hook_event_name: "UserPromptSubmit",
          cwd: repo,
          session_id: "session-e2e",
          prompt: "how do I create local-only storage?",
        },
        { mode: "advisory" },
        {
          collectTelemetry: collectFixture,
          assess: quietAssessment,
          recordUsage: recordUsageEvent,
        },
      );

      const graph = invokeArchitectureTool("architecture.query_assessment_graph", {
        repoRoot: repo,
        sessionId: "session-e2e",
        nodeTypes: ["claim"],
        limit: 2,
      });
      expect(graph.ok).toBe(true);

      handleClaudeHookEvent(
        {
          hook_event_name: "UserPromptSubmit",
          cwd: repo,
          session_id: "session-e2e",
          prompt: "thanks, that makes sense",
        },
        { mode: "advisory" },
        {
          collectTelemetry: collectFixture,
          assess: quietAssessment,
          recordUsage: recordUsageEvent,
        },
      );

      const store = new TechLeadPersistenceStore(repo);
      store.appendUsageEvent({
        id: "usage-simulated-missed-engagement",
        occurredAt: "2026-05-02T14:04:00.000Z",
        repoRoot: repo,
        sessionId: "session-e2e",
        source: "hook",
        engagementType: "passive_silence",
        outcome: "quiet",
        metadata: {
          architectureRelevant: true,
          baselineExists: true,
          missedEngagementCandidate: true,
          prompt: "raw missed prompt must not persist",
        },
      });
      store.close();

      const review = invokeArchitectureTool("architecture.review_usage", {
        repoRoot: repo,
        sessionId: "session-e2e",
        limit: 20,
      });

      expect(review.ok).toBe(true);
      expect(review.ok ? review.result : undefined).toMatchObject({
        summary: {
          byEngagementType: expect.objectContaining({
            followup_injection: 1,
            passive_silence: 2,
            graph_query: 1,
          }),
        },
        notableGaps: [
          expect.objectContaining({ id: "usage-simulated-missed-engagement" }),
        ],
      });
      const rendered = JSON.stringify(review.ok ? review.result : {});
      expect(rendered).not.toContain("baseline capture raw prompt");
      expect(rendered).not.toContain("local-only storage");
      expect(rendered).not.toContain("raw missed prompt");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function collectFixture(event: { cwd: string; kind: string }): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
} {
  return {
    event: {
      host: "claude-code",
      event: event.kind,
      cwd: event.cwd,
      recentRequests: [],
      changedFiles: [],
      repoSignals: { status: "absent" },
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    },
    telemetry: {
      lifecycle: [],
      repository: [],
      change: [],
      test: [],
      memory: [],
      runtime: [],
      diagnostics: [],
    },
  };
}

function quietAssessment(): AssessmentResult {
  return {
    status: "ok",
    action: "Continue",
    reason: "Current evidence does not require adding structure yet.",
    intervention: "note",
    baseline: {
      repoRoot: "/repo",
      generatedAt: "2026-05-02T14:00:00.000Z",
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    evidence: [],
    questions: [],
    revisitAlerts: [],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    principleGuidance: [],
  };
}
