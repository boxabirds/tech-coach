import { describe, expect, it } from "vitest";
import { compareClaims } from "./claimComparator.js";
import { reportJourneys, reportRealRepoClaims, reportScenarioSuite } from "./evaluationReport.js";
import { runJourney } from "./journeyRunner.js";
import { runScenarioSuite } from "./runner.js";
import { persistence } from "../../../fixtures/cases/scenarios.js";
import { cosmeticFalsePositiveControl } from "../../../fixtures/journeys/journeys.js";

describe("evaluation report failure classification", () => {
  it("classifies fixture failures as extraction or policy failures", () => {
    const report = reportScenarioSuite(runScenarioSuite([{
      ...persistence,
      expectation: {
        ...persistence.expectation,
        requiredSignalFamilies: ["runtime"],
        expectedActions: ["Run review"],
      },
    }]));

    expect(report.passed).toBe(false);
    expect(report.summary.byCategory.extraction_failure).toBe(1);
    expect(report.summary.byCategory.policy_failure).toBe(1);
    expect(report.items[0]?.failures.map((failure) => failure.kind)).toEqual(
      expect.arrayContaining(["missing_signal_family", "unexpected_action"]),
    );
  });

  it("classifies journey timing failures as policy interview and host rendering failures", () => {
    const failed = runJourney({
      ...cosmeticFalsePositiveControl,
      turns: [{
        ...cosmeticFalsePositiveControl.turns[0],
        correlationId: "wrong-correlation",
        expected: {
          ...cosmeticFalsePositiveControl.turns[0].expected,
          expectedInterview: true,
          expectedAction: "Run review",
        },
      }],
    });
    const report = reportJourneys([failed]);

    expect(report.summary.byCategory.policy_failure).toBe(1);
    expect(report.summary.byCategory.interview_failure).toBe(1);
    expect(report.summary.byCategory.host_rendering_failure).toBe(1);
  });

  it("classifies brownfield claim failures as extraction or interview failures", () => {
    const result = compareClaims({
      name: "repo",
      path: "/repo",
      requiredClaims: [{
        concern: "authentication",
        claimContains: ["external OAuth"],
      }],
      requiredResidualQuestions: ["Which access-control risk"],
      forbiddenQuestions: ["Should the coach assume no roles"],
    }, {
      claims: [],
      questions: [{
        id: "q",
        concern: "authorization",
        kind: "choose",
        prompt: "Should the coach assume no roles?",
        reason: "bad",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      evidenceText: [],
      facts: [],
    });
    const report = reportRealRepoClaims([result]);

    expect(report.summary.byCategory.extraction_failure).toBe(1);
    expect(report.summary.byCategory.interview_failure).toBe(2);
  });
});
