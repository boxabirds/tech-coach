import { describe, expect, it } from "vitest";
import {
  runScenario,
  runScenarioSuite,
  validateScenarioFixture,
} from "./runner.js";
import {
  persistence,
  scenarioFixtures,
} from "../../../fixtures/cases/scenarios.js";

describe("scenario evidence runner", () => {
  it("passes the golden scenario evidence suite", () => {
    const result = runScenarioSuite(scenarioFixtures);

    expect(result).toMatchObject({
      passed: true,
      summary: {
        total: 10,
        passed: 10,
        failed: 0,
      },
    });
  });

  it("reports an empty suite as not configured", () => {
    expect(runScenarioSuite([])).toEqual({
      passed: false,
      results: [],
      summary: { total: 0, passed: 0, failed: 0 },
    });
  });

  it("returns scenario-level assessment details for successful fixtures", () => {
    const result = runScenario(persistence);

    expect(result).toMatchObject({
      name: "persistence-needs-storage-decision",
      passed: true,
      diagnostics: [],
      mismatches: [],
      assessment: {
        intervention: "recommend",
        action: "Insert boundary",
      },
    });
  });

  it("fails malformed fixtures with clear diagnostics", () => {
    const result = runScenario({
      name: "",
      memory: "not-array",
      expectation: {},
    });

    expect(result).toMatchObject({
      name: "unnamed scenario",
      passed: false,
      mismatches: [],
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        { field: "name", message: "must be a non-empty string" },
        { field: "event", message: "is required" },
        { field: "memory", message: "must be an array" },
        { field: "expectation.requiredThresholds", message: "must be an array" },
      ]),
    );
  });

  it("rejects missing required expectations unless explicit silence is expected", () => {
    expect(validateScenarioFixture({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredThresholds: [],
      },
    })).toContainEqual({
      field: "expectation.requiredThresholds",
      message: "must contain at least one item",
    });

    expect(validateScenarioFixture({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredThresholds: [],
        expectedSilence: true,
      },
    })).not.toContainEqual({
      field: "expectation.requiredThresholds",
      message: "must contain at least one item",
    });
  });

  it("rejects contradictory expectations", () => {
    const diagnostics = validateScenarioFixture({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        expectedActions: ["Record decision"],
        forbiddenActions: ["Record decision"],
      },
    });

    expect(diagnostics).toContainEqual({
      field: "expectation",
      message: "expectedActions and forbiddenActions must not overlap",
    });
  });

  it("rejects unknown action names", () => {
    const diagnostics = validateScenarioFixture({
      ...persistence,
      expectation: {
        ...persistence.expectation,
        expectedActions: ["Invent microservice"],
      },
    });

    expect(diagnostics).toContainEqual({
      field: "expectation.expectedActions",
      message: "contains unknown action names",
    });
  });

  it("turns invalid telemetry fixtures into scenario diagnostics", () => {
    const result = runScenario({
      ...persistence,
      telemetry: {
        lifecycle: [{ id: "", family: "lifecycle" }],
        repository: [],
        change: [],
        test: [],
        memory: [],
        runtime: [],
        diagnostics: [],
      },
    });

    expect(result).toMatchObject({
      passed: false,
      mismatches: [],
    });
    expect(result.diagnostics[0]?.message).toContain("lifecycle[0].id");
  });
});
