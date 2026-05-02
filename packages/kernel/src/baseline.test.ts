import { describe, expect, it } from "vitest";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import {
  baseEvent,
  broadDiffEvent,
  brownfieldEvent,
  brownfieldEvidence,
  signal,
} from "./__fixtures__/baseline/scenarios.js";

describe("synthesizeArchitectureBaseline", () => {
  it("builds a concern baseline for a brownfield repository from shared evidence", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
    });

    const persistence = baseline.concerns.find(
      (concern) => concern.concern === "data_storage",
    );
    const stateOwnership = baseline.concerns.find(
      (concern) => concern.concern === "state_ownership",
    );

    expect(persistence).toMatchObject({
      currentState: "Owned",
      confidence: "high",
      thresholdCandidates: ["persistence"],
      axes: {
        complexity: "medium",
        irreversibility: "medium",
        solutionVisibility: "high",
        planningHorizon: "high",
      },
    });
    expect(persistence?.facts[0]).toMatchObject({
      status: "observed",
      confidence: "high",
      freshness: "current",
    });
    expect(stateOwnership?.thresholdCandidates).toContain("state_ownership");
    expect(baseline.diagnostics).toEqual([]);
  });

  it("keeps a greenfield or empty repository exploratory with explicit unknowns", () => {
    const baseline = synthesizeArchitectureBaseline({ event: baseEvent });

    expect(baseline.facts).toEqual([]);
    expect(baseline.diagnostics).toContainEqual({
      id: "diagnostic-no-evidence",
      severity: "info",
      message: "No concrete architecture evidence was available.",
    });
    expect(
      baseline.concerns.find((concern) => concern.concern === "data_storage"),
    ).toMatchObject({
      currentState: "Exploratory",
      confidence: "low",
    });
    expect(
      baseline.unknowns.map((unknown) => unknown.concern),
    ).toEqual(expect.arrayContaining(["data_storage", "deployment", "testing"]));
  });

  it("produces a partial baseline when an evidence provider fails", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("layout", "file_layout", "medium", ["Vite app entrypoint main.tsx"]),
        {
          source: "lsp",
          status: "failed",
          category: "symbol_reference",
          freshness: "unknown",
          confidence: "low",
          evidence: [],
          error: "language server unavailable",
        },
      ],
    });

    expect(
      baseline.concerns.find((concern) => concern.concern === "application_shape"),
    ).toBeDefined();
    expect(baseline.diagnostics).toContainEqual({
      id: "diagnostic-1-lsp",
      severity: "warning",
      source: "lsp",
      message: "lsp failed: language server unavailable",
    });
  });

  it("does not assign high confidence from keyword-only weak signals", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("prompt-snippet", "symbol_reference", "low", [
          "Maybe share projects later; localStorage is mentioned in a TODO",
        ]),
      ],
    });

    const persistence = baseline.concerns.find(
      (concern) => concern.concern === "data_storage",
    );

    expect(persistence).toMatchObject({
      currentState: "Exploratory",
      confidence: "low",
      thresholdCandidates: expect.arrayContaining(["persistence", "collaboration"]),
    });
    expect(persistence?.facts[0]).toMatchObject({
      status: "inferred",
      confidence: "low",
    });
  });

  it("marks a concern for revisit when current work matches a prior decision trigger", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: {
        ...baseEvent,
        userRequest: "Let teammates share projects",
        recentRequests: ["Add saved projects"],
      },
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage repository stores saved projects in localStorage",
        ]),
      ],
      priorDecisions: [
        {
          id: "decision-localstorage-projects",
          concern: "project persistence",
          decision: "Use localStorage while project is single-user",
          revisitIf: ["sharing", "sync", "user accounts"],
        },
      ],
    });

    const persistence = baseline.concerns.find(
      (concern) => concern.concern === "data_storage",
    );

    expect(persistence).toMatchObject({
      currentState: "Revisit",
      thresholdCandidates: expect.arrayContaining(["persistence", "revisit"]),
    });
  });

  it("detects blast-radius pressure from broad changed-file spread", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: broadDiffEvent,
      evidence: [
        signal("layout", "file_layout", "medium", ["React app with src directory"]),
      ],
    });

    const risk = baseline.concerns.find(
      (concern) => concern.concern === "risk_hotspot",
    );

    expect(risk).toMatchObject({
      currentState: "Emerging",
      thresholdCandidates: ["blast_radius"],
      axes: {
        complexity: "high",
        irreversibility: "medium",
        solutionVisibility: "low",
        planningHorizon: "high",
      },
    });
  });

  it("keeps conflicting evidence low confidence and records risk pressure", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("diagnostics", "diagnostic", "high", [
          "Conflict: broad diff contradicts existing module ownership",
        ]),
      ],
    });

    const risk = baseline.concerns.find(
      (concern) => concern.concern === "risk_hotspot",
    );

    expect(risk).toMatchObject({
      confidence: "low",
      currentState: "Exploratory",
      thresholdCandidates: ["blast_radius"],
    });
  });
});
