import { describe, expect, it } from "vitest";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import { selectArchitecturePrinciples } from "./principles.js";
import {
  baseEvent,
  brownfieldEvent,
  signal,
} from "./__fixtures__/baseline/scenarios.js";

describe("selectArchitecturePrinciples", () => {
  it("maps state ownership pressure to concrete design principles", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("imports", "import_relationship", "high", [
          "ProjectEditor imports projectStorage, uses useState, and handles URL serialization",
        ]),
      ],
    });
    const state = baseline.concerns.find((concern) => concern.concern === "state_ownership");

    const principles = selectArchitecturePrinciples({
      concern: state!,
      facts: baseline.facts,
    });

    expect(principles.map((principle) => principle.id)).toEqual(
      expect.arrayContaining([
        "separation_of_concerns",
        "clear_ownership",
        "right_sized_abstraction",
      ]),
    );
    expect(principles.every((principle) => principle.evidence.length > 0)).toBe(true);
  });

  it("maps persistence pressure to stable contracts and reversible decisions", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage repository stores saved projects in localStorage",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage");

    const principles = selectArchitecturePrinciples({
      concern: storage!,
      facts: baseline.facts,
    });

    expect(principles.map((principle) => principle.id)).toEqual(
      expect.arrayContaining([
        "stable_contract",
        "right_sized_abstraction",
        "reversible_decision",
        "testability",
      ]),
    );
  });

  it("degrades confidence for weak, stale, or conflicting evidence", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        {
          ...signal("diagnostics", "diagnostic", "high", [
            "Conflict: broad diff contradicts existing module ownership",
          ]),
          freshness: "stale",
        },
      ],
    });
    const risk = baseline.concerns.find((concern) => concern.concern === "risk_hotspot");

    const principles = selectArchitecturePrinciples({
      concern: risk!,
      facts: baseline.facts,
    });

    expect(principles.length).toBeGreaterThan(0);
    expect(principles.every((principle) => principle.confidence === "low")).toBe(true);
  });

  it("does not emit abstract principles for no-pressure exploratory work", () => {
    const baseline = synthesizeArchitectureBaseline({ event: baseEvent });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage");

    expect(
      selectArchitecturePrinciples({ concern: storage!, facts: baseline.facts }),
    ).toEqual([]);
  });
});
