import { describe, expect, it } from "vitest";
import { telemetryFromEvidence } from "./telemetry.js";
import {
  checkRevisit,
  collectCurrentEvidence,
  conditionMatchesEvidence,
} from "./revisit.js";
import { decisionRecordsToMemorySignals } from "./memory.js";
import {
  authShortcutDecision,
  localStorageDecision,
  nonMatchingEvent,
  revisitEvent,
} from "./__fixtures__/memory/scenarios.js";
import { signal } from "./__fixtures__/telemetry/scenarios.js";

describe("revisit matching helpers", () => {
  it("matches direct and tokenized revisit conditions against current evidence", () => {
    expect(conditionMatchesEvidence("sharing", "Let teammates enable sharing for saved projects")).toBe(true);
    expect(conditionMatchesEvidence("public deployment", "Prepare the app for public deployment")).toBe(true);
    expect(conditionMatchesEvidence("user accounts", "Add account settings for users")).toBe(false);
    expect(conditionMatchesEvidence("", "sharing")).toBe(false);
  });

  it("collects current evidence from events and non-memory telemetry", () => {
    const telemetry = telemetryFromEvidence({
      event: revisitEvent,
      evidence: [
        signal("imports", "import_relationship", "present", "current", "medium", [
          "ProjectEditor imports projectStorage for saved project sync",
        ]),
      ],
      capturedAt: "2026-04-30T13:00:00.000Z",
      correlationId: "turn-revisit",
    });

    const evidence = collectCurrentEvidence(revisitEvent, telemetry);

    expect(evidence).toEqual(
      expect.arrayContaining([
        { signalId: "event-0", text: "Let teammates enable sharing for saved projects" },
        expect.objectContaining({
          signalId: expect.stringContaining("change:imports"),
          text: "ProjectEditor imports projectStorage for saved project sync",
        }),
      ]),
    );
  });
});

describe("checkRevisit", () => {
  it("returns no alerts when no decision memory is available", () => {
    expect(checkRevisit({ event: revisitEvent })).toEqual([]);
  });

  it("returns no alerts when current evidence does not match revisit conditions", () => {
    expect(checkRevisit({
      event: nonMatchingEvent,
      records: [localStorageDecision],
    })).toEqual([]);
  });

  it("alerts when current request matches a recorded revisit condition", () => {
    const alerts = checkRevisit({
      event: revisitEvent,
      records: [localStorageDecision],
    });

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        decisionId: "decision-localstorage-projects",
        concern: "project persistence",
        decision: localStorageDecision.decision,
        reason: localStorageDecision.reason,
        risk: localStorageDecision.risks,
        matchedCondition: "sharing",
        signalIds: ["event-0"],
        currentEvidence: ["Let teammates enable sharing for saved projects"],
        recommendedAction: "Replace substrate",
      }),
    ]));
  });

  it("checks memory telemetry and cites correlated signal evidence", () => {
    const telemetry = telemetryFromEvidence({
      event: revisitEvent,
      evidence: [
        signal("imports", "import_relationship", "present", "current", "medium", [
          "ProjectEditor imports projectStorage for saved project sync",
        ]),
      ],
      capturedAt: "2026-04-30T13:00:00.000Z",
      correlationId: "turn-revisit",
    });
    telemetry.memory.push(
      ...decisionRecordsToMemorySignals([localStorageDecision], {
        capturedAt: "2026-04-30T13:00:00.000Z",
        correlationId: "turn-revisit",
      }),
    );

    const alerts = checkRevisit({ event: revisitEvent, telemetry });

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: "decision-localstorage-projects",
          matchedCondition: "sharing",
          signalIds: expect.arrayContaining(["event-0"]),
          recommendedAction: "Replace substrate",
        }),
        expect.objectContaining({
          decisionId: "decision-localstorage-projects",
          matchedCondition: "sync",
          signalIds: expect.arrayContaining([
            expect.stringContaining("change:imports"),
          ]),
          currentEvidence: expect.arrayContaining([
            "ProjectEditor imports projectStorage for saved project sync",
          ]),
        }),
      ]),
    );
  });

  it("returns multiple alerts for multiple matching decisions", () => {
    const event = {
      ...revisitEvent,
      userRequest: "Prepare public deployment and team access",
      recentRequests: ["Let teammates enable sharing for saved projects"],
    };

    const alerts = checkRevisit({
      event,
      records: [localStorageDecision, authShortcutDecision],
    });

    expect(alerts.map((alert) => alert.decisionId)).toEqual(
      expect.arrayContaining([
        "decision-localstorage-projects",
        "decision-no-auth",
      ]),
    );
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: "decision-no-auth",
          matchedCondition: "public deployment",
          recommendedAction: "Run review",
        }),
      ]),
    );
  });

  it("ignores empty revisit conditions in malformed telemetry rather than inventing matches", () => {
    const telemetry = telemetryFromEvidence({
      event: revisitEvent,
      capturedAt: "2026-04-30T13:00:00.000Z",
    });
    telemetry.memory.push({
      id: "memory-empty",
      family: "memory",
      source: "memory-empty",
      capturedAt: "2026-04-30T13:00:00.000Z",
      freshness: "current",
      confidence: "low",
      scope: "concern",
      status: "present",
      payload: {
        id: "memory-empty",
        concern: "project persistence",
        decision: "Unknown",
        revisitIf: [],
        evidence: [],
      },
    });

    expect(checkRevisit({ event: revisitEvent, telemetry })).toEqual([]);
  });
});
