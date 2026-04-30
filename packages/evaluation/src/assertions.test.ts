import { describe, expect, it } from "vitest";
import {
  assertScenarioExpectation,
  collectEvidenceCategories,
  collectSignalFamilies,
  collectThresholds,
} from "./assertions.js";
import { runScenario } from "./runner.js";
import {
  expiredAssumption,
  persistence,
  simpleFirstFeature,
} from "../../../fixtures/cases/scenarios.js";

describe("scenario expectation assertions", () => {
  it("collects thresholds, signal families, and evidence categories from a real assessment", () => {
    const result = runScenario(persistence);

    expect(result.assessment).toBeDefined();
    expect(Array.from(collectThresholds(result.assessment!))).toEqual(
      expect.arrayContaining(["persistence"]),
    );
    expect(Array.from(collectSignalFamilies(result.assessment!, persistence.telemetry))).toEqual(
      expect.arrayContaining(["lifecycle", "repository", "test"]),
    );
    expect(Array.from(collectEvidenceCategories(result.assessment!))).toEqual(
      expect.arrayContaining(["configuration_boundary", "test_posture"]),
    );
  });

  it("fails when a required threshold is missing", () => {
    const result = runScenario({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredThresholds: ["public_api"],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual(
      expect.objectContaining({ kind: "missing_threshold", expected: "public_api" }),
    );
  });

  it("fails when an expected evidence category is not cited", () => {
    const result = runScenario({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredEvidenceCategories: ["runtime_error"],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual(
      expect.objectContaining({ kind: "missing_evidence_category", expected: "runtime_error" }),
    );
  });

  it("fails when a required signal family is not present or cited", () => {
    const result = runScenario({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredSignalFamilies: ["runtime"],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual(
      expect.objectContaining({ kind: "missing_signal_family", expected: "runtime" }),
    );
  });

  it("fails forbidden overengineering actions explicitly", () => {
    const result = runScenario({
      ...expiredAssumption,
      expectation: {
        ...expiredAssumption.expectation,
        expectedActions: ["Record decision"],
        forbiddenActions: ["Replace substrate"],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual(
      expect.objectContaining({ kind: "forbidden_action", actual: "Replace substrate" }),
    );
  });

  it("fails expected silence when the assessment asks for a visible decision", () => {
    const result = runScenario({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredThresholds: [],
        allowedInterventions: ["note"],
        expectedActions: ["Continue"],
        expectedSilence: true,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unexpected_intervention" }),
        expect.objectContaining({ kind: "unexpected_action" }),
        expect.objectContaining({ kind: "expected_silence" }),
      ]),
    );
  });

  it("passes a no-action scenario without treating plausible prose as evidence", () => {
    const result = runScenario(simpleFirstFeature);

    expect(result.passed).toBe(true);
    expect(assertScenarioExpectation({
      result: result.assessment!,
      expectation: simpleFirstFeature.expectation,
      telemetry: simpleFirstFeature.telemetry,
    })).toEqual([]);
  });
});
