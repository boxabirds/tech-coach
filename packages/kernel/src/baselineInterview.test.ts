import { describe, expect, it } from "vitest";
import { planBaselineInterviewQuestions } from "./baselineInterview.js";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import { emptyTelemetryBundle, telemetryFromEvidence } from "./telemetry.js";
import {
  baseEvent,
  brownfieldEvent,
  brownfieldEvidence,
  signal,
} from "./__fixtures__/baseline/scenarios.js";

describe("planBaselineInterviewQuestions", () => {
  it("asks targeted questions for uncertain high-impact brownfield facts", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "symbol_reference", "low", [
          "Project TODO mentions moving localStorage to shared database",
        ]),
        signal("layout", "file_layout", "medium", [
          "React app with pages and components",
        ]),
      ],
    });

    const questions = planBaselineInterviewQuestions({ baseline });

    expect(questions[0]).toMatchObject({
      concern: "data_storage",
      kind: "correct",
      relatedFactIds: ["fact-data_storage"],
    });
    expect(questions[0]?.prompt).toContain("persistence");
    expect(questions[0]?.reason).toContain("low confidence");
  });

  it("asks about high-impact unknowns only when there is enough project evidence", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
    });

    const questions = planBaselineInterviewQuestions({ baseline });

    expect(questions.map((question) => question.concern)).toEqual(
      expect.arrayContaining(["authentication", "deployment"]),
    );
    expect(questions.find((question) => question.concern === "deployment")).toMatchObject({
      kind: "choose",
      relatedUnknownIds: ["unknown-deployment"],
    });
  });

  it("uses telemetry diagnostics for missing or conflicting signal families", () => {
    const telemetry = telemetryFromEvidence({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-14",
    });
    telemetry.diagnostics.push({
      id: "diagnostic-test-family-failed",
      family: "test",
      severity: "warning",
      source: "testSummary",
      message: "test signal family is failed",
    });
    telemetry.diagnostics.push({
      id: "diagnostic-change-conflict",
      family: "change",
      severity: "info",
      source: "lsp",
      message: "conflicting change signal contradicts imported symbol evidence",
    });
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      telemetry,
    });

    const questions = planBaselineInterviewQuestions({ baseline, telemetry }, 8);

    expect(questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "question-signal-testing-diagnostic-test-family-failed",
          concern: "testing",
          kind: "free_text",
          relatedSignalIds: ["diagnostic-test-family-failed"],
        }),
        expect.objectContaining({
          id: "question-signal-risk_hotspot-diagnostic-change-conflict",
          concern: "risk_hotspot",
          kind: "correct",
          relatedSignalIds: ["diagnostic-change-conflict"],
        }),
      ]),
    );
  });

  it("honors question limits by ranking highest-impact uncertainties first", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "symbol_reference", "low", [
          "Maybe use localStorage before a database",
        ]),
      ],
    });

    const questions = planBaselineInterviewQuestions({ baseline }, 1);

    expect(questions).toHaveLength(1);
    expect(questions[0]?.concern).toBe("data_storage");
  });

  it("does not force a generic interview for low-signal greenfield baselines", () => {
    const baseline = synthesizeArchitectureBaseline({ event: baseEvent });
    const telemetry = emptyTelemetryBundle();

    expect(planBaselineInterviewQuestions({ baseline, telemetry })).toEqual([]);
  });
});
