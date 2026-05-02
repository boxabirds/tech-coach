import { describe, expect, it } from "vitest";
import {
  runJourney,
  validateJourneyFixture,
} from "./journeyRunner.js";
import {
  cosmeticFalsePositiveControl,
  interviewRequiredThenAnswered,
  journeyFixtures,
  localPersistenceToCollaboration,
} from "../../../fixtures/journeys/journeys.js";

describe("journey timing runner", () => {
  it("passes the golden multi-turn journey fixtures", () => {
    const results = journeyFixtures.map(runJourney);

    expect(results).toHaveLength(6);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.map((result) => result.name)).toEqual(
      expect.arrayContaining([
        "prototype-to-named-state-owner",
        "local-persistence-to-collaboration",
        "demo-auth-to-production",
        "deployment-operationalization",
        "interview-required-then-answered",
        "cosmetic-false-positive-control",
      ]),
    );
  });

  it("carries initial memory through every turn assessment", () => {
    const result = runJourney(localPersistenceToCollaboration);

    expect(result.passed).toBe(true);
    expect(result.turns.map((turn) => turn.memoryDecisionCount)).toEqual([1, 1]);
    expect(result.turns[1]?.assessment).toMatchObject({
      intervention: "decision-required",
      action: "Replace substrate",
    });
  });

  it("applies host-collected answers through the shared baseline merger", () => {
    const result = runJourney(interviewRequiredThenAnswered);

    expect(result.passed).toBe(true);
    const firstTurn = result.turns[0];
    expect(firstTurn?.questionIds).toContain("question-fact-data_storage-fact-data-storage");
    expect(firstTurn?.appliedAnswerQuestionIds).toEqual([
      "question-fact-data_storage-fact-data-storage",
    ]);
    expect(firstTurn?.answeredBaseline?.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: "question-fact-data_storage-fact-data-storage",
        status: "user_confirmed",
      }),
    );
    expect(result.turns[1]?.carriedBaseline?.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: "question-fact-data_storage-fact-data-storage",
        status: "user_confirmed",
      }),
    );
  });

  it("keeps cosmetic journeys quiet across repeated turns", () => {
    const result = runJourney(cosmeticFalsePositiveControl);

    expect(result.passed).toBe(true);
    expect(result.turns.map((turn) => turn.assessment?.action)).toEqual([
      "Continue",
      "Continue",
    ]);
    expect(result.turns.flatMap((turn) => turn.questionIds)).toEqual([]);
  });

  it("fails missing required host answers rather than treating questions as confirmed", () => {
    const fixture = {
      ...interviewRequiredThenAnswered,
      turns: [
        {
          ...interviewRequiredThenAnswered.turns[0],
          hostAnswers: undefined,
        },
      ],
    };

    const result = runJourney(fixture);

    expect(result.passed).toBe(false);
    expect(result.turns[0]?.mismatches).toContainEqual(
      expect.objectContaining({
        kind: "missing_answer",
        expected: "question-fact-data_storage-fact-data-storage",
      }),
    );
  });

  it("fails host answers for unknown question ids", () => {
    const fixture = {
      ...interviewRequiredThenAnswered,
      turns: [
        {
          ...interviewRequiredThenAnswered.turns[0],
          hostAnswers: [{
            questionId: "question-does-not-exist",
            action: "confirm",
            value: "user said something",
          }],
          expected: {
            ...interviewRequiredThenAnswered.turns[0].expected,
            expectedResolvedQuestionIds: ["question-does-not-exist"],
          },
        },
      ],
    };

    const result = runJourney(fixture);

    expect(result.passed).toBe(false);
    expect(result.turns[0]?.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_answer" }),
        expect.objectContaining({ kind: "invalid_answer" }),
      ]),
    );
  });

  it("reports invalid telemetry as a turn diagnostic", () => {
    const fixture = {
      ...cosmeticFalsePositiveControl,
      turns: [{
        ...cosmeticFalsePositiveControl.turns[0],
        telemetry: {
          lifecycle: [{ id: "", family: "lifecycle" }],
          repository: [],
          change: [],
          test: [],
          memory: [],
          runtime: [],
          diagnostics: [],
        },
      }],
    };

    const result = runJourney(fixture);

    expect(result.passed).toBe(false);
    expect(result.turns[0]?.diagnostics[0]?.message).toContain("lifecycle[0].id");
  });

  it("validates turn order, duplicate turns, and missing correlation ids", () => {
    const diagnostics = validateJourneyFixture({
      name: "bad journey",
      initialMemory: [],
      turns: [
        { turn: 2, event: {}, expected: { expectedIntervention: "silent" } },
        { turn: 2, event: {}, correlationId: "turn-2", expected: {} },
      ],
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        {
          field: "turns[0].turn",
          message: "must preserve turn order starting at 1",
        },
        { field: "turns[0].correlationId", message: "is required" },
        { field: "turns[1].turn", message: "must be unique" },
        {
          field: "turns[1].expected.expectedIntervention",
          message: "is required",
        },
      ]),
    );
  });
});
