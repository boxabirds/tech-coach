import { describe, expect, it } from "vitest";
import { assessArchitecture } from "./assessment.js";
import {
  classifyComplexityPressure,
  classifyStructuralSupport,
  compareStructureAdequacy,
  debtAssessmentFor,
} from "./complexity.js";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import {
  baseEvent,
  brownfieldEvent,
  signal,
} from "./__fixtures__/baseline/scenarios.js";
import { localStorageDecision } from "./__fixtures__/memory/scenarios.js";

describe("complexity pressure and structural support", () => {
  it("classifies high persistence pressure separately from localized support", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: {
        ...brownfieldEvent,
        userRequest: "Let teams share saved projects",
      },
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "Saved projects write to localStorage and now need team sharing, sync, and collaboration.",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage")!;

    expect(storage.pressure).toMatchObject({
      level: "high",
      drivers: expect.arrayContaining(["durable_state", "collaboration"]),
      provisional: false,
    });
    expect(storage.support).toMatchObject({
      level: "localized",
      supports: ["localized implementation"],
    });
    expect(storage.adequacy).toMatchObject({
      status: "under_structured",
      nextAction: "insert_boundary",
    });
  });

  it("marks lexical-only pressure as provisional instead of decisive", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("prompt", "symbol_reference", "low", [
          "Maybe database later.",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage")!;

    expect(classifyComplexityPressure(storage)).toMatchObject({
      level: "medium",
      confidence: "low",
      provisional: true,
    });
    expect(storage.adequacy?.status).toBe("unknown");
  });

  it("recognizes bounded support when structure already absorbs pressure", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage repository boundary stores saved projects and exposes a persistence adapter.",
        ]),
        signal("tests", "test_posture", "high", [
          "Repository boundary tests verify save and load behavior.",
        ]),
      ],
    });
    const storage = baseline.concerns.find((concern) => concern.concern === "data_storage")!;
    const support = classifyStructuralSupport(storage);

    expect(support).toMatchObject({
      level: "bounded",
      supports: expect.arrayContaining(["repository boundary"]),
    });
    expect(compareStructureAdequacy(storage, storage.pressure!, support)).toMatchObject({
      status: "adequate",
    });
  });

  it("distinguishes accepted architecture debt from unaccepted findings", () => {
    const result = assessArchitecture({
      event: {
        ...brownfieldEvent,
        userRequest: "Let teams share saved projects",
        optionalSignals: [
          signal("storage", "configuration_boundary", "high", [
            "Saved projects write to localStorage and now need team sharing and collaboration.",
          ]),
        ],
      },
      memoryRecords: [localStorageDecision],
    });

    expect(result.architectureDebt).toContainEqual(
      expect.objectContaining({
        concern: "data_storage",
        status: "accepted_debt",
        pressure: "high",
        support: "localized",
        revisitIf: ["sharing", "sync", "user accounts"],
      }),
    );

    const unaccepted = debtAssessmentFor({
      adequacy: result.structureReasoning!.find((item) => item.concern === "data_storage")!,
    });
    expect(unaccepted).toMatchObject({
      status: "finding",
      concern: "data_storage",
    });
  });

  it("exposes pressure support adequacy in assessment output without debt labels by default", () => {
    const result = assessArchitecture({
      event: {
        ...brownfieldEvent,
        optionalSignals: [
          signal("storage", "configuration_boundary", "high", [
            "Saved projects write to localStorage and now need team sharing and collaboration.",
          ]),
        ],
      },
    });

    expect(result.policy?.selected).toMatchObject({
      concern: "data_storage",
      action: "Insert boundary",
      adequacy: expect.objectContaining({
        status: "under_structured",
      }),
    });
    expect(result.structureReasoning).toContainEqual(
      expect.objectContaining({
        concern: "data_storage",
        pressure: "high",
        support: "localized",
        status: "under_structured",
      }),
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        family: "complexity",
        summary: expect.stringContaining("under_structured"),
      }),
    );
    expect(result.architectureDebt).toContainEqual(
      expect.objectContaining({
        concern: "data_storage",
        status: "finding",
      }),
    );
  });
});
