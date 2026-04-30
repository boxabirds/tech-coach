import { describe, expect, it } from "vitest";
import {
  assertTurnTiming,
  presentSignalFamilies,
  visibleIntervention,
} from "./timingAssertions.js";
import { runJourney } from "./journeyRunner.js";
import {
  cosmeticFalsePositiveControl,
  interviewRequiredThenAnswered,
  prototypeToNamed,
} from "../../../fixtures/journeys/journeys.js";

describe("journey timing assertions", () => {
  it("treats no-op assessments as silent visible interventions", () => {
    const result = runJourney(cosmeticFalsePositiveControl);
    const assessment = result.turns[0]?.assessment;

    expect(assessment).toBeDefined();
    expect(visibleIntervention(assessment!)).toBe("silent");
  });

  it("collects present telemetry families from a turn bundle", () => {
    const telemetry = prototypeToNamed.turns[1].telemetry!;

    expect(Array.from(presentSignalFamilies(telemetry))).toEqual(
      expect.arrayContaining(["lifecycle", "change"]),
    );
  });

  it("flags missing required signal families", () => {
    const result = runJourney(cosmeticFalsePositiveControl);
    const turn = cosmeticFalsePositiveControl.turns[0];

    const mismatches = assertTurnTiming({
      assessment: result.turns[0].assessment!,
      telemetry: turn.telemetry!,
      correlationId: turn.correlationId,
      expectation: {
        ...turn.expected,
        requiredSignalFamilies: ["runtime"],
      },
    });

    expect(mismatches).toContainEqual(
      expect.objectContaining({ kind: "missing_signal_family", expected: "runtime" }),
    );
  });

  it("flags interview expectations in both directions", () => {
    const quietResult = runJourney(cosmeticFalsePositiveControl);
    const quietTurn = cosmeticFalsePositiveControl.turns[0];
    const interviewResult = runJourney(interviewRequiredThenAnswered);
    const interviewTurn = interviewRequiredThenAnswered.turns[0];

    const missingInterview = assertTurnTiming({
      assessment: quietResult.turns[0].assessment!,
      telemetry: quietTurn.telemetry!,
      correlationId: quietTurn.correlationId,
      expectation: {
        ...quietTurn.expected,
        expectedInterview: true,
      },
    });
    const unexpectedInterview = assertTurnTiming({
      assessment: interviewResult.turns[0].assessment!,
      telemetry: interviewTurn.telemetry!,
      correlationId: interviewTurn.correlationId,
      expectation: {
        ...interviewTurn.expected,
        expectedInterview: false,
        expectedResolvedQuestionIds: [],
      },
    });

    expect(missingInterview).toContainEqual(
      expect.objectContaining({ kind: "missing_interview" }),
    );
    expect(unexpectedInterview).toContainEqual(
      expect.objectContaining({ kind: "unexpected_interview" }),
    );
  });

  it("flags action and maturity state timing mismatches", () => {
    const result = runJourney(prototypeToNamed);
    const turn = prototypeToNamed.turns[1];

    const mismatches = assertTurnTiming({
      assessment: result.turns[1].assessment!,
      priorAssessment: result.turns[0].assessment!,
      telemetry: turn.telemetry!,
      correlationId: turn.correlationId,
      expectation: {
        ...turn.expected,
        expectedAction: "Run review",
        expectedFromState: "LoadBearing",
        expectedToState: "LoadBearing",
      },
    });

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unexpected_action" }),
        expect.objectContaining({ kind: "unexpected_from_state" }),
        expect.objectContaining({ kind: "unexpected_to_state" }),
      ]),
    );
  });

  it("flags missing or mismatched correlation ids", () => {
    const result = runJourney(cosmeticFalsePositiveControl);
    const turn = cosmeticFalsePositiveControl.turns[0];

    const missingCorrelation = assertTurnTiming({
      assessment: result.turns[0].assessment!,
      telemetry: turn.telemetry!,
      expectation: turn.expected,
    });
    const mismatchedCorrelation = assertTurnTiming({
      assessment: result.turns[0].assessment!,
      telemetry: turn.telemetry!,
      correlationId: "wrong-correlation",
      expectation: turn.expected,
    });

    expect(missingCorrelation).toContainEqual(
      expect.objectContaining({ kind: "missing_correlation" }),
    );
    expect(mismatchedCorrelation).toContainEqual(
      expect.objectContaining({
        kind: "missing_correlation",
        expected: "wrong-correlation",
      }),
    );
  });
});
