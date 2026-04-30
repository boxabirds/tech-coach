import { describe, expect, it } from "vitest";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import { planBaselineInterviewQuestions } from "./baselineInterview.js";
import { applyBaselineAnswers } from "./baselineMerge.js";
import {
  baseEvent,
  brownfieldEvent,
  brownfieldEvidence,
  signal,
} from "./__fixtures__/baseline/scenarios.js";

describe("applyBaselineAnswers", () => {
  it("confirms inferred facts without deleting original evidence", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: [
        signal("storage", "symbol_reference", "low", [
          "Maybe use localStorage before a database",
        ]),
      ],
    });
    const questions = planBaselineInterviewQuestions({ baseline });

    const merged = applyBaselineAnswers({
      baseline,
      questions,
      answers: [
        {
          questionId: questions[0]?.id ?? "",
          action: "confirm",
          value: "localStorage is intentional for the prototype",
          answerId: "answer-confirm-storage",
        },
      ],
      recordedAt: "2026-04-30T12:00:00.000Z",
    });

    const fact = merged.facts.find((item) => item.id === "fact-data_storage");
    expect(fact).toMatchObject({
      status: "user_confirmed",
      sources: [
        expect.objectContaining({
          source: "storage",
          category: "symbol_reference",
        }),
      ],
      confirmations: [
        expect.objectContaining({
          status: "user_confirmed",
          value: "localStorage is intentional for the prototype",
        }),
      ],
    });
    expect(merged.confirmations).toContainEqual(
      expect.objectContaining({
        answerId: "answer-confirm-storage",
        factId: "fact-data_storage",
      }),
    );
  });

  it("adds corrections as separate facts and records conflicts with strong observations", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
    });
    const questions = [
      {
        id: "question-fact-data_storage-fact-data_storage",
        concern: "data_storage" as const,
        kind: "correct" as const,
        prompt: "Correct persistence assumption",
        reason: "user correction",
        relatedFactIds: ["fact-data_storage"],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      },
    ];

    const merged = applyBaselineAnswers({
      baseline,
      questions,
      answers: [
        {
          questionId: questions[0].id,
          action: "correct",
          value: "Postgres stores shared project data",
          answerId: "answer-correct-storage",
        },
      ],
      recordedAt: "2026-04-30T12:00:00.000Z",
    });

    expect(merged.facts.find((fact) => fact.id === "fact-data_storage")).toMatchObject({
      status: "observed",
      sources: expect.arrayContaining([
        expect.objectContaining({ source: "config" }),
      ]),
    });
    expect(merged.facts).toContainEqual(
      expect.objectContaining({
        id: "fact-user-answer-correct-storage",
        concern: "data_storage",
        status: "user_corrected",
        summary: "Postgres stores shared project data",
      }),
    );
    expect(merged.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("conflicts with observed fact fact-data_storage"),
      }),
    );
  });

  it("marks known shortcuts as intentionally temporary", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
    });
    const questions = [
      {
        id: "question-fact-data_storage-fact-data_storage",
        concern: "data_storage" as const,
        kind: "confirm" as const,
        prompt: "Confirm persistence",
        reason: "temporary shortcut",
        relatedFactIds: ["fact-data_storage"],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      },
    ];

    const merged = applyBaselineAnswers({
      baseline,
      questions,
      answers: [
        {
          questionId: questions[0].id,
          action: "mark_temporary",
          value: "Keep localStorage until team sharing starts",
          answerId: "answer-temp-storage",
        },
      ],
      recordedAt: "2026-04-30T12:00:00.000Z",
    });

    expect(merged.facts.find((fact) => fact.id === "fact-data_storage")).toMatchObject({
      status: "intentionally_temporary",
      confirmations: [
        expect.objectContaining({
          status: "intentionally_temporary",
          value: "Keep localStorage until team sharing starts",
        }),
      ],
    });
  });

  it("keeps skipped unknowns unresolved and records duplicate or unknown answer diagnostics", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: brownfieldEvent,
      evidence: brownfieldEvidence,
    });
    const questions = planBaselineInterviewQuestions({ baseline });
    const deploymentQuestion = questions.find(
      (question) => question.concern === "deployment",
    );

    const merged = applyBaselineAnswers({
      baseline,
      questions,
      answers: [
        {
          questionId: deploymentQuestion?.id ?? "",
          action: "skip",
          answerId: "answer-skip-deploy",
        },
        {
          questionId: deploymentQuestion?.id ?? "",
          action: "confirm",
          value: "public hosted app",
          answerId: "answer-duplicate-deploy",
        },
        {
          questionId: "question-does-not-exist",
          action: "confirm",
          answerId: "answer-unknown",
        },
      ],
      recordedAt: "2026-04-30T12:00:00.000Z",
    });

    expect(merged.unknowns).toContainEqual(
      expect.objectContaining({ id: "unknown-deployment" }),
    );
    expect(merged.confirmations).toContainEqual(
      expect.objectContaining({
        answerId: "answer-skip-deploy",
        status: "unresolved",
      }),
    );
    expect(merged.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining("Duplicate answer"),
        }),
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining("unknown question"),
        }),
      ]),
    );
  });

  it("resolves unknowns by adding user-confirmed facts through the shared baseline model", () => {
    const baseline = synthesizeArchitectureBaseline({
      event: baseEvent,
      evidence: [
        signal("layout", "file_layout", "medium", [
          "Small React app with a main.tsx entrypoint",
        ]),
      ],
    });
    const questions = planBaselineInterviewQuestions({ baseline });
    const deploymentQuestion = questions.find(
      (question) => question.concern === "deployment",
    );

    const merged = applyBaselineAnswers({
      baseline,
      questions,
      answers: [
        {
          questionId: deploymentQuestion?.id ?? "",
          action: "confirm",
          value: "private hosted app",
          answerId: "answer-confirm-deploy",
        },
      ],
      recordedAt: "2026-04-30T12:00:00.000Z",
    });

    expect(merged.unknowns).not.toContainEqual(
      expect.objectContaining({ id: "unknown-deployment" }),
    );
    expect(merged.facts).toContainEqual(
      expect.objectContaining({
        id: "fact-user-answer-confirm-deploy",
        concern: "deployment",
        status: "user_confirmed",
        sources: [expect.objectContaining({ source: "user" })],
      }),
    );
  });
});
