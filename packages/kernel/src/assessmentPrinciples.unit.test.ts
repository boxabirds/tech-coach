import { describe, expect, it } from "vitest";
import { assessArchitecture, type AssessmentResult } from "./assessment.js";
import { storageBoundaryEvent } from "./__fixtures__/principles/scenarios.js";

describe("assessment principle output contract", () => {
  it("preserves existing assessment fields while exposing structured guidance", () => {
    const result: AssessmentResult = assessArchitecture({ event: storageBoundaryEvent });

    expect(typeof result.status).toBe("string");
    expect(typeof result.intervention).toBe("string");
    expect(typeof result.action).toBe("string");
    expect(typeof result.reason).toBe("string");
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.doNotAdd)).toBe(true);
    expect(typeof result.memory.status).toBe("string");
    expect(typeof result.memory.decisionCount).toBe("number");
    expect(result.baseline).toBeDefined();
    expect(Array.isArray(result.questions)).toBe(true);
    expect(Array.isArray(result.revisitAlerts)).toBe(true);
    expect(Array.isArray(result.principleGuidance)).toBe(true);

    const storage = result.principleGuidance.find(
      (guidance) => guidance.concern === "data_storage",
    );

    expect(storage).toMatchObject({
      principles: [
        expect.objectContaining({
          id: "stable_contract",
          evidence: expect.any(Array),
        }),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      ],
      patterns: [
        expect.objectContaining({
          pattern: "insert_repository_boundary",
          addNow: expect.any(String),
          doNotAddYet: expect.any(String),
          evidence: expect.any(Array),
          missingEvidence: expect.any(Array),
          confidence: expect.any(String),
        }),
        expect.any(Object),
      ],
      contract: {
        owner: expect.any(String),
        dependents: expect.any(String),
        exclusions: expect.any(String),
        tests: expect.any(String),
      },
    });
  });
});
