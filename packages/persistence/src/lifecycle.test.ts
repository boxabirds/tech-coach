import { describe, expect, it } from "vitest";
import {
  assertLifecycleTransition,
  buildLifecycleAuditRecord,
  canTransitionLifecycle,
  lifecycleForCapture,
} from "./lifecycle.js";

describe("persistence lifecycle", () => {
  it("allows the durable capture path and rejects impossible transitions", () => {
    expect(canTransitionLifecycle("not_started", "capturing")).toBe(true);
    expect(canTransitionLifecycle("capturing", "captured")).toBe(true);
    expect(canTransitionLifecycle("captured", "interview_open")).toBe(true);
    expect(canTransitionLifecycle("interview_open", "interview_updated")).toBe(true);
    expect(canTransitionLifecycle("interview_updated", "decision_confirmed")).toBe(true);
    expect(canTransitionLifecycle("decision_confirmed", "rerun_reused")).toBe(true);

    expect(() => assertLifecycleTransition("not_started", "decision_confirmed"))
      .toThrow(/Invalid persistence lifecycle transition/);
  });

  it("classifies capture outcomes from evidence, questions, and reused state", () => {
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [],
      openQuestionCount: 0,
      reusedState: false,
    })).toBe("captured");
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [],
      openQuestionCount: 2,
      reusedState: false,
    })).toBe("interview_open");
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [{ severity: "warning" }],
      openQuestionCount: 0,
      reusedState: false,
    })).toBe("partial_capture");
    expect(lifecycleForCapture({
      previousRunExists: true,
      diagnostics: [],
      openQuestionCount: 0,
      reusedState: true,
    })).toBe("rerun_reused");
  });

  it("builds compact lifecycle audit records with correlation and redacted evidence shape", () => {
    const record = buildLifecycleAuditRecord({
      kind: "PostToolBatch",
      repoRoot: "/repo",
      mode: "strict",
      effect: "block",
      createdAt: "2026-05-01T00:00:00.000Z",
      assessment: {
        status: "needs_attention",
        intervention: "recommend",
        action: "Record decision",
        reason: "Baseline has unconfirmed assumptions.",
        evidence: [{
          source: "fixture",
          summary: "  Evidence with\nextra whitespace  ",
        }],
        doNotAdd: [],
        memory: { status: "absent", decisionCount: 0 },
        baseline: {
          repoRoot: "/repo",
          generatedAt: "2026-05-01T00:00:00.000Z",
          concerns: [],
          facts: [],
          unknowns: [],
          diagnostics: [],
        },
        questions: [{
          id: "question-storage",
          concern: "data_storage",
          kind: "confirm",
          prompt: "Does storage need to be shared?",
          reason: "Sharing changes persistence.",
          relatedFactIds: [],
          relatedUnknownIds: [],
          relatedSignalIds: [],
        }],
        revisitAlerts: [],
        principleGuidance: [],
      },
    });

    expect(record).toMatchObject({
      auditId: "lifecycle-PostToolBatch-PostToolBatch-2026-05-01T00-00-00-000Z-2026-05-01T00-00-00-000Z",
      kind: "PostToolBatch",
      mode: "strict",
      effect: "block",
      action: "Record decision",
      intervention: "recommend",
      evidence: ["Evidence with extra whitespace"],
      questionIds: ["question-storage"],
      degraded: false,
    });
  });
});
