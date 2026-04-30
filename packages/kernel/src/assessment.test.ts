import { describe, expect, it } from "vitest";
import {
  assessArchitecture,
  AssessmentValidationError,
  normalizeAssessmentInput,
} from "./assessment.js";
import { telemetryFromEvidence } from "./telemetry.js";
import {
  brownfieldEvent,
  brownfieldEvidence,
} from "./__fixtures__/baseline/scenarios.js";
import { localStorageDecision, revisitEvent } from "./__fixtures__/memory/scenarios.js";

describe("assessArchitecture", () => {
  it("assesses legacy event input by converting it through telemetry", () => {
    const result = assessArchitecture({
      event: {
        ...brownfieldEvent,
        optionalSignals: brownfieldEvidence,
      },
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      intervention: "recommend",
      action: "Record decision",
      memory: { status: "absent", decisionCount: 0 },
    });
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "repository",
          source: "layout",
          category: "file_layout",
        }),
      ]),
    );
  });

  it("assesses typed telemetry input and preserves signal citations", () => {
    const telemetry = telemetryFromEvidence({
      event: {
        ...brownfieldEvent,
        optionalSignals: brownfieldEvidence,
      },
      evidence: brownfieldEvidence,
      capturedAt: "2026-04-30T14:00:00.000Z",
      correlationId: "turn-cli",
    });

    const result = assessArchitecture({ telemetry });

    expect(result.baseline.repoRoot).toBe("/repo");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        family: "change",
        source: "imports",
        signalId: "change:imports:import_relationship",
      }),
    );
  });

  it("returns revisit alerts when project memory conditions match current work", () => {
    const result = assessArchitecture({
      event: revisitEvent,
      memoryRecords: [localStorageDecision],
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      intervention: "recommend",
      action: "Replace substrate",
      memory: { status: "loaded", decisionCount: 1 },
    });
    expect(result.revisitAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: "decision-localstorage-projects",
          matchedCondition: "sharing",
        }),
      ]),
    );
  });

  it("rejects telemetry input without lifecycle context", () => {
    expect(() =>
      normalizeAssessmentInput({
        lifecycle: [],
        repository: [],
        change: [],
        test: [],
        memory: [],
        runtime: [],
        diagnostics: [],
      }),
    ).toThrow(AssessmentValidationError);
  });
});
