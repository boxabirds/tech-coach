import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import {
  handleClaudeHookEvent,
  recordLifecycleAudit,
} from "../../claude-hooks/src/hookAdapter.js";
import { TechLeadPersistenceStore } from "../../persistence/src/store.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("Claude lifecycle coaching E2E", () => {
  maybeIt("runs SessionStart, UserPromptSubmit, PostToolBatch, and Stop with persisted audit records", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-lifecycle-e2e-"));
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(
      join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
      "Action: Record decision\nReason: persistence shortcut is active\n",
    );

    try {
      const runtime = {
        now: () => "2026-05-01T00:00:00.000Z",
        collectTelemetry: () => collectFixture(repo),
        assess: () => assessmentFixture(repo),
        recordAudit: recordLifecycleAudit,
      };

      const session = handleClaudeHookEvent(
        { hook_event_name: "SessionStart", cwd: repo, session_id: "session-1" },
        { mode: "advisory" },
        runtime,
      );
      const prompt = handleClaudeHookEvent(
        { hook_event_name: "UserPromptSubmit", cwd: repo, prompt: "Add team sharing" },
        { mode: "balanced" },
        runtime,
      );
      const postTools = handleClaudeHookEvent(
        { hook_event_name: "PostToolBatch", cwd: repo, changed_files: ["src/storage.ts"] },
        { mode: "strict" },
        runtime,
      );
      const stop = handleClaudeHookEvent(
        { hook_event_name: "Stop", cwd: repo, stop_hook_active: false },
        { mode: "strict" },
        runtime,
      );

      expect(session.effect).toBe("inject");
      expect(prompt.effect).toBe("inject");
      expect(postTools.effect).toBe("block");
      expect(stop.effect).toBe("block");

      const store = new TechLeadPersistenceStore(repo);
      expect(new Set(store.listLifecycleAudit().map((record) => record.kind))).toEqual(new Set([
        "SessionStart",
        "UserPromptSubmit",
        "PostToolBatch",
        "Stop",
      ]));
      expect(store.listLifecycleAudit()).toContainEqual(
        expect.objectContaining({
          kind: "PostToolBatch",
          mode: "strict",
          effect: "block",
          action: "Record decision",
        }),
      );
      store.close();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function collectFixture(repo: string): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
} {
  const event: CoachEventEnvelope = {
    host: "claude-code",
    event: "PostToolBatch",
    cwd: repo,
    userRequest: "Add team sharing",
    recentRequests: [],
    changedFiles: ["src/storage.ts"],
    repoSignals: {
      status: "present",
      evidence: ["React app with local storage"],
    },
    memoryRefs: [],
    priorDecisions: [],
    optionalSignals: [],
  };
  return {
    event,
    telemetry: {
      lifecycle: [{
        id: "lifecycle-session",
        family: "lifecycle",
        source: "claude-code",
        capturedAt: "2026-05-01T00:00:00.000Z",
        freshness: "current",
        confidence: "high",
        scope: "session",
        status: "present",
        correlationId: "session-1",
        payload: {
          host: "claude-code",
          event: "PostToolBatch",
          cwd: repo,
          userRequest: "Add team sharing",
          recentRequests: [],
        },
      }],
      repository: [],
      change: [],
      test: [],
      memory: [],
      runtime: [],
      diagnostics: [],
    },
  };
}

function assessmentFixture(repo: string): AssessmentResult {
  return {
    status: "needs_attention",
    intervention: "recommend",
    action: "Record decision",
    reason: "Baseline has a high-impact unconfirmed assumption.",
    evidence: [{
      family: "repository",
      source: "fixture",
      category: "repo_summary",
      summary: "Local storage will become shared state.",
    }],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    baseline: {
      repoRoot: repo,
      generatedAt: "2026-05-01T00:00:00.000Z",
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    questions: [{
      id: "question-storage-sharing",
      concern: "data_storage",
      kind: "confirm",
      prompt: "Does shared project data need multi-user persistence?",
      reason: "Sharing changes persistence responsibility.",
      relatedFactIds: [],
      relatedUnknownIds: [],
      relatedSignalIds: [],
    }],
    revisitAlerts: [],
    principleGuidance: [],
    temporalBrief: { past: [], current: [], future: [], uncertain: [] },
  };
}
