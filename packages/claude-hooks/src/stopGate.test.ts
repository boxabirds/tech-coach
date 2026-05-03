import { describe, expect, it } from "vitest";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { evaluateClaudeStopGate } from "./stopGate.js";
import { handleClaudeHookEvent } from "./hookAdapter.js";

describe("Claude Stop unsafe completion gate", () => {
  it("never blocks advisory mode but can describe unresolved guidance", () => {
    const decision = evaluateClaudeStopGate({
      mode: "advisory",
      assessment: assessmentFixture({ intervention: "block", action: "Run review" }),
      telemetry: telemetryFixture(),
      loopGuardActive: false,
    });

    expect(decision.outcome).toBe("note");
    expect(decision.message).toContain("advisory mode allows completion");
  });

  it("blocks balanced mode for unresolved block assessments", () => {
    const decision = evaluateClaudeStopGate({
      mode: "balanced",
      assessment: assessmentFixture({
        intervention: "block",
        action: "Run review",
        reason: "Real auth is unresolved.",
      }),
      telemetry: telemetryFixture(),
      loopGuardActive: false,
    });

    expect(decision.outcome).toBe("block");
    expect(decision.reason).toBe("Real auth is unresolved.");
    expect(decision.signalIds).toContain("signal-auth");
    expect(decision.message).toContain("Required action: Run review.");
  });

  it("blocks balanced mode for high-risk unresolved interview questions", () => {
    const question = questionFixture({
      id: "question-auth-owner",
      concern: "authentication",
      prompt: "Who owns real account access?",
    });
    const decision = evaluateClaudeStopGate({
      mode: "balanced",
      assessment: assessmentFixture({
        intervention: "note",
        questions: [question],
      }),
      unresolvedQuestions: [question],
      loopGuardActive: false,
    });

    expect(decision.outcome).toBe("block");
    expect(decision.questionIds).toEqual(["question-auth-owner"]);
    expect(decision.message).toContain("[question-auth-owner] Who owns real account access?");
    expect(decision.message).toContain("do not invent answers");
  });

  it("blocks strict mode for unresolved recommend assessments", () => {
    const decision = evaluateClaudeStopGate({
      mode: "strict",
      assessment: assessmentFixture({
        intervention: "recommend",
        action: "Insert boundary",
      }),
      loopGuardActive: false,
    });

    expect(decision.outcome).toBe("block");
    expect(decision.message).toContain("Required action: Insert boundary.");
  });

  it("finishes when no unresolved assessment or question remains", () => {
    const decision = evaluateClaudeStopGate({
      mode: "strict",
      assessment: assessmentFixture({
        intervention: "note",
        action: "Continue",
        status: "ok",
      }),
      loopGuardActive: false,
    });

    expect(decision.outcome).toBe("finish");
  });

  it("finishes when the Stop loop guard is already active", () => {
    const decision = evaluateClaudeStopGate({
      mode: "strict",
      assessment: assessmentFixture({ intervention: "block" }),
      loopGuardActive: true,
    });

    expect(decision.outcome).toBe("finish");
    expect(decision.reason).toContain("loop guard");
  });

  it("integrates with the Claude hook adapter and renders a block response", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "Stop",
        cwd: process.cwd(),
        stop_hook_active: false,
      },
      { mode: "strict" },
      {
        collectTelemetry: () => ({
          event: {
            host: "claude-code",
            event: "Stop",
            cwd: process.cwd(),
            recentRequests: [],
            changedFiles: [],
            repoSignals: { status: "absent" },
            memoryRefs: [],
            priorDecisions: [],
            optionalSignals: [],
          },
          telemetry: telemetryFixture(),
        }),
        assess: () => assessmentFixture({
          intervention: "recommend",
          action: "Record decision",
          questions: [questionFixture()],
        }),
      },
    );

    expect(response.effect).toBe("block");
    expect(response.message).toContain("Architecture completion gate");
    expect(response.message).toContain("[question-data-storage]");
  });
});

function assessmentFixture(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
  return {
    status: "needs_attention",
    intervention: "recommend",
    action: "Record decision",
    reason: "Architecture guidance remains unresolved.",
    evidence: [{
      source: "fixture",
      signalId: "signal-auth",
      summary: "Authentication evidence is unresolved.",
    }],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    baseline: {
      repoRoot: process.cwd(),
      generatedAt: "2026-05-01T00:00:00.000Z",
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    questions: [],
    revisitAlerts: [],
    principleGuidance: [],
    temporalBrief: { past: [], current: [], future: [], uncertain: [] },
    ...overrides,
  };
}

function questionFixture(overrides: Partial<BaselineQuestion> = {}): BaselineQuestion {
  return {
    id: "question-data-storage",
    concern: "data_storage",
    kind: "choose",
    prompt: "Does this data need to survive across devices?",
    reason: "Persistence responsibility affects the architecture boundary.",
    relatedFactIds: [],
    relatedUnknownIds: [],
    relatedSignalIds: [],
    options: [],
    ...overrides,
  };
}

function telemetryFixture(): ArchitecturalTelemetryBundle {
  return {
    lifecycle: [{
      id: "signal-stop",
      family: "lifecycle",
      source: "claude-code",
      capturedAt: "2026-05-01T00:00:00.000Z",
      freshness: "current",
      confidence: "high",
      scope: "session",
      status: "present",
      correlationId: "corr-1",
      payload: {
        host: "claude-code",
        event: "Stop",
        cwd: process.cwd(),
        recentRequests: [],
      },
    }],
    repository: [{
      id: "signal-auth",
      family: "repository",
      source: "fixture",
      capturedAt: "2026-05-01T00:00:00.000Z",
      freshness: "current",
      confidence: "high",
      scope: "repo",
      status: "present",
      correlationId: "corr-1",
      payload: {
        category: "repo_summary",
        repoRoot: process.cwd(),
        evidence: ["auth module present"],
      },
    }],
    change: [],
    test: [],
    memory: [],
    runtime: [],
    diagnostics: [],
  };
}
