import { describe, expect, it } from "vitest";
import { assessArchitecture } from "./assessment.js";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import { baseEvent, brownfieldEvent, signal } from "./__fixtures__/baseline/scenarios.js";

describe("explicit architecture policy", () => {
  it("keeps maturity independent per concern", () => {
    const result = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Refactor project editor state ownership.",
        optionalSignals: [
          signal("auth", "architecture_claim", "high", [
            "Authentication route uses OAuth sessions and account login.",
          ]),
        ],
      },
    });

    expect(result.policy?.concerns).toContainEqual(
      expect.objectContaining({
        concern: "authentication",
        maturity: "LoadBearing",
        thresholds: expect.arrayContaining(["identity", "security"]),
      }),
    );
    expect(result.policy?.concerns).toContainEqual(
      expect.objectContaining({
        concern: "data_storage",
        maturity: "Exploratory",
        thresholds: [],
      }),
    );
  });

  it("classifies every v1 threshold without making lexical-only evidence decisive", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: {
        ...brownfieldEvent,
        userRequest: "Share projects through a public API after the local storage decision",
        priorDecisions: [{
          id: "decision-local-storage",
          concern: "project persistence",
          decision: "Use localStorage while single user",
          revisitIf: ["share"],
        }],
      },
      evidence: [
        signal("state", "symbol_reference", "high", [
          "Duplicated useState store orchestration repeats URL serialization rules.",
        ]),
        signal("storage", "configuration_boundary", "high", [
          "projectStorage repository uses localStorage and needs team sharing sync collaboration.",
        ]),
        signal("auth", "architecture_claim", "high", [
          "OAuth account login with authorization role access control protects user sessions.",
        ]),
        signal("api", "symbol_reference", "high", [
          "Public API endpoint request response contract is used by external clients.",
        ]),
        signal("deploy", "configuration_boundary", "high", [
          "Cloudflare production deploy hosting configuration is active.",
        ]),
        signal("ops", "monitor_event", "high", [
          "Runtime logs, metrics, alerts, and health check exist for production.",
        ]),
        signal("risk", "diagnostic", "high", [
          "Broad diff touches many files and creates blast radius risk.",
        ]),
        signal("weak", "symbol_reference", "low", [
          "Maybe database later.",
        ]),
      ],
      priorDecisions: [{
        id: "decision-local-storage",
        concern: "project persistence",
        decision: "Use localStorage while single user",
        revisitIf: ["share"],
      }],
    });

    const thresholds = new Set(
      baseline.concerns.flatMap((concern) => concern.thresholdCandidates),
    );

    expect(Array.from(thresholds).sort()).toEqual([
      "blast_radius",
      "collaboration",
      "deployment",
      "identity",
      "operational",
      "persistence",
      "public_api",
      "repetition",
      "revisit",
      "security",
      "state_ownership",
    ].sort());
    expect(
      baseline.concerns.find((concern) => concern.concern === "data_storage")?.confidence,
    ).toBe("high");
  });

  it("chooses right-sized actions and exposes the machine-readable policy path", () => {
    const result = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Refactor project editor state ownership.",
        optionalSignals: [
          signal("state-imports", "import_relationship", "high", [
            "ProjectEditor uses useState, useEffect, and URL serialization.",
          ]),
          signal("state-shape", "architecture_shape", "high", [
            "ProjectEditor has repeated state orchestration mixed with rendering.",
          ]),
        ],
      },
    });

    expect(result.policy?.selected).toMatchObject({
      concern: "state_ownership",
      action: "Extract",
      intervention: "recommend",
      thresholdCandidates: expect.arrayContaining(["state_ownership"]),
      principleIds: expect.arrayContaining([
        "separation_of_concerns",
        "right_sized_abstraction",
        "clear_ownership",
      ]),
      patternId: "extract_custom_hook",
      provisional: false,
    });
    expect(result.action).toBe("Extract");
    expect(result.doNotAdd).toContainEqual(expect.stringContaining("global state"));
  });

  it("inserts a repository boundary before replacing the storage substrate", () => {
    const result = assessArchitecture({
      event: {
        ...brownfieldEvent,
        optionalSignals: [
          signal("storage", "configuration_boundary", "high", [
            "projectStorage repository stores saved projects in localStorage",
          ]),
        ],
      },
    });

    expect(result.policy?.selected).toMatchObject({
      concern: "data_storage",
      action: "Insert boundary",
      patternId: "insert_repository_boundary",
    });
    expect(result.action).toBe("Insert boundary");
    expect(result.action).not.toBe("Replace substrate");
    expect(result.doNotAdd).toContainEqual(expect.stringContaining("server database"));
  });

  it("selects operationalize and security review from explicit thresholds", () => {
    const deployment = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Prepare deployment operations guidance.",
        optionalSignals: [
          signal("deploy", "configuration_boundary", "high", [
            "Cloudflare production deploy hosting logs health check runtime responsibility.",
          ]),
        ],
      },
    });
    const security = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Review identity and authorization security risk.",
        optionalSignals: [
          signal("auth", "architecture_claim", "high", [
            "OAuth session login with authorization role access control.",
          ]),
        ],
      },
    });

    expect(deployment.policy?.selected).toMatchObject({
      concern: "deployment",
      action: "Operationalize",
      intervention: "interview-required",
      patternId: "operationalize_runtime",
    });
    expect(security.policy?.selected).toMatchObject({
      concern: "authentication",
      action: "Run review",
      intervention: "decision-required",
      patternId: "run_security_review",
    });
  });

  it("uses provisional guidance for weak evidence and avoids blocking", () => {
    const result = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Recommend the next storage architecture move.",
        optionalSignals: [
          signal("weak-storage", "symbol_reference", "low", [
            "Maybe localStorage or database later.",
          ]),
        ],
      },
    });

    expect(result.policy?.selected).toMatchObject({
      action: "Insert boundary",
      intervention: "interview-required",
      provisional: true,
    });
    expect(result.intervention).not.toBe("block");
  });

  it("keeps passive repository baselines observational even when boundaries are visible", () => {
    const result = assessArchitecture({
      event: {
        ...baseEvent,
        userRequest: "Capture a passive repository baseline.",
        optionalSignals: [
          signal("shape", "architecture_shape", "high", [
            "Runtime boundary candidates: React/TypeScript frontend and Rust/WASM or native-module markers are both present.",
          ]),
          signal("auth", "architecture_claim", "high", [
            "OAuth session login with authorization role access control.",
          ]),
        ],
      },
    });

    expect(result.interactionContext).toBe("passive_baseline");
    expect(result.policy?.selected).toMatchObject({
      action: "Continue",
      intervention: "note",
      requiresQuestion: false,
    });
    expect(result.questions).toEqual([]);
    expect(result.reason).toContain("no immediate architecture move is required");
  });
});
