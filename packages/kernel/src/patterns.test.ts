import { describe, expect, it } from "vitest";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import { selectArchitecturePrinciples } from "./principles.js";
import {
  describeBoundaryContract,
  selectStructuralPatterns,
} from "./patterns.js";
import {
  baseEvent,
  brownfieldEvent,
  signal,
} from "./__fixtures__/baseline/scenarios.js";

describe("structural pattern policy", () => {
  it("recommends custom hook extraction only when state evidence shows mixed responsibilities", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("symbols", "symbol_reference", "high", [
          "ProjectEditor imports projectStorage, uses useState, and handles URL serialization",
        ]),
      ],
    });
    const state = baseline.concerns.find((concern) => concern.concern === "state_ownership")!;
    const principles = selectArchitecturePrinciples({ concern: state, facts: baseline.facts });
    const patterns = selectStructuralPatterns({ concern: state, principles, facts: baseline.facts });

    expect(patterns[0]).toMatchObject({
      pattern: "extract_custom_hook",
      addNow: expect.stringContaining("custom hook"),
      doNotAddYet: expect.stringContaining("global state"),
      missingEvidence: [],
    });
    expect(describeBoundaryContract({ pattern: patterns[0], concern: state })).toMatchObject({
      owner: expect.stringContaining("custom hook"),
      exclusions: expect.stringContaining("Rendering stays"),
    });
  });

  it("does not recommend React hooks merely because React appears", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("layout", "file_layout", "high", [
          "React app with src/pages and src/components",
        ]),
        signal("imports", "import_relationship", "medium", [
          "Shared state appears in project workflow",
        ]),
      ],
    });
    const state = baseline.concerns.find((concern) => concern.concern === "state_ownership")!;
    const principles = selectArchitecturePrinciples({ concern: state, facts: baseline.facts });
    const patterns = selectStructuralPatterns({ concern: state, principles, facts: baseline.facts });

    expect(patterns[0]).toMatchObject({
      pattern: "name_state_owner",
      missingEvidence: ["mixed rendering/effects/state orchestration evidence"],
      confidence: "low",
    });
  });

  it("recommends repository boundaries before database escalation", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage repository stores saved projects in localStorage",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage")!;
    const principles = selectArchitecturePrinciples({ concern: storage, facts: baseline.facts });
    const patterns = selectStructuralPatterns({ concern: storage, principles, facts: baseline.facts });

    expect(patterns[0]).toMatchObject({
      pattern: "insert_repository_boundary",
      addNow: expect.stringContaining("repository"),
      doNotAddYet: expect.stringContaining("server database"),
      missingEvidence: [],
    });
    expect(describeBoundaryContract({ pattern: patterns[0], concern: storage })).toMatchObject({
      owner: expect.stringContaining("repository"),
      dependents: expect.stringContaining("persistence behavior"),
    });
  });

  it("returns provisional or missing-evidence guidance for weak evidence", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("prompt", "symbol_reference", "low", [
          "Maybe localStorage will be used later",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage")!;
    const principles = selectArchitecturePrinciples({ concern: storage, facts: baseline.facts });
    const patterns = selectStructuralPatterns({ concern: storage, principles, facts: baseline.facts });

    expect(patterns[0]).toMatchObject({
      pattern: "insert_repository_boundary",
      confidence: "low",
    });
    expect(describeBoundaryContract({ pattern: patterns[0], concern: storage })).toMatchObject({
      provisional: expect.stringContaining("provisional"),
    });
  });

  it("supports API contracts and targeted test harnesses", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("route", "symbol_reference", "high", [
          "Public API endpoint changes request and response contract",
        ]),
      ],
    });
    const api = baseline.concerns.find((concern) => concern.concern === "api_contract")!;
    const principles = selectArchitecturePrinciples({ concern: api, facts: baseline.facts });
    const patterns = selectStructuralPatterns({ concern: api, principles, facts: baseline.facts });

    expect(patterns.map((pattern) => pattern.pattern)).toEqual(
      expect.arrayContaining(["record_api_contract", "add_targeted_test_harness"]),
    );
    expect(patterns.find((pattern) => pattern.pattern === "record_api_contract")).toMatchObject({
      addNow: expect.stringContaining("request, response"),
      doNotAddYet: expect.stringContaining("public compatibility"),
    });
  });
});
