import { describe, expect, it } from "vitest";
import type { AssessmentResult } from "./assessment.js";
import type { ArchitectureConcern, BaselineQuestion } from "./baselineTypes.js";
import type { ArchitecturalTelemetryBundle, SignalEnvelope } from "./telemetryTypes.js";
import {
  formatSpecialistReviewResult,
  routeSpecialistReviews,
  type ReviewFinding,
} from "./escalation.js";

describe("specialist risk review routing", () => {
  it("routes security risk to the security reviewer", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("authentication", "block"),
      telemetry: telemetryWith(repositorySignal("security-auth", [
        "auth login session permission secret public exposure",
      ])),
    });

    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      concern: "security",
      reviewer: "security-reviewer",
      signalIds: ["security-auth"],
    });
    expect(result.requests[0].question).toContain("identity, authorization");
  });

  it("routes persistence risk without jumping straight to a database", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("data_storage"),
      telemetry: telemetryWith(repositorySignal("persistence", [
        "localStorage saved project repository migration user data",
      ])),
    });

    expect(result.requests[0]).toMatchObject({
      concern: "persistence",
      reviewer: "persistence-reviewer",
    });
    expect(result.requests[0].question).toContain("persistence ownership");
  });

  it("routes deployment risk to deployment reviewer", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("deployment"),
      telemetry: telemetryWith(repositorySignal("deploy", [
        "production deploy cloudflare secrets rollback health check",
      ])),
    });

    expect(result.requests[0]).toMatchObject({
      concern: "deployment",
      reviewer: "deployment-reviewer",
    });
  });

  it("routes public API contract risk to API contract reviewer", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("api_contract"),
      telemetry: telemetryWith(
        repositorySignal("api", [
          "public API endpoint request response contract external caller",
        ]),
        changeSignal("api-change", [
          "public API endpoint request response contract external caller",
        ]),
      ),
    });

    expect(result.requests[0]).toMatchObject({
      concern: "api_contract",
      reviewer: "api-contract-reviewer",
    });
  });

  it("routes broad change spread to architecture reviewer", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("risk_hotspot"),
      telemetry: telemetryWith(changeSignal("spread", [
        "broad diff many files changed files blast radius",
      ])),
    });

    expect(result.requests[0]).toMatchObject({
      concern: "architecture_spread",
      reviewer: "architecture-reviewer",
    });
  });

  it("does not escalate routine low-risk work", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("entrypoint", "note", "Continue"),
      telemetry: telemetryWith(repositorySignal("frontend", [
        "React frontend shape package boundary",
      ])),
    });

    expect(result.requests).toEqual([]);
  });

  it("skips when the required signal family is missing", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("api_contract"),
      telemetry: telemetryWith(changeSignal("api-change", [
        "public API endpoint request response contract external caller",
      ])),
    });

    expect(result.requests).toEqual([]);
    expect(result.skipped).toContainEqual({
      concern: "api_contract",
      reason: "Required telemetry signal family is missing.",
    });
  });

  it("skips when signal family is present but evidence is insufficient", () => {
    const result = routeSpecialistReviews({
      assessment: assessmentFor("data_storage"),
      telemetry: telemetryWith(repositorySignal("frontend-only", [
        "component layout route rendering",
      ])),
    });

    expect(result.requests).toEqual([]);
    expect(result.skipped).toContainEqual({
      concern: "persistence",
      reason: "Insufficient telemetry-backed evidence.",
    });
  });

  it("skips unavailable reviewers without erasing the original signpost", () => {
    const assessment = assessmentFor("deployment");
    const result = routeSpecialistReviews({
      assessment,
      availableReviewers: ["security-reviewer"],
      telemetry: telemetryWith(repositorySignal("deploy", [
        "production deploy cloudflare secrets rollback health check",
      ])),
    });

    expect(result.requests).toEqual([]);
    expect(result.skipped).toContainEqual({
      concern: "deployment",
      reason: "deployment-reviewer is unavailable.",
    });
    expect(assessment.reason).toContain("requires review");
  });

  it("handles multiple eligible reviewers when evidence supports them", () => {
    const result = routeSpecialistReviews({
      assessment: {
        ...assessmentFor("authentication"),
        baseline: {
          ...assessmentFor("authentication").baseline,
          concerns: [
            concernFor("authentication"),
            concernFor("data_storage"),
          ],
        },
      },
      telemetry: telemetryWith(repositorySignal("auth-storage", [
        "auth login permission secret localStorage database repository migration user data",
      ])),
    });

    expect(result.requests.map((request) => request.concern)).toEqual([
      "security",
      "persistence",
    ]);
  });

  it("formats a no-finding specialist result without losing original action", () => {
    const assessment = assessmentFor("data_storage");
    const request = routeSpecialistReviews({
      assessment,
      telemetry: telemetryWith(repositorySignal("persistence", [
        "localStorage saved project repository migration user data",
      ])),
    }).requests[0];
    const result = formatSpecialistReviewResult({
      request,
      findings: [],
      openQuestions: [],
      originalAssessment: assessment,
    });

    expect(result.findings).toEqual([]);
    expect(result.nextAction).toBe(assessment.action);
    expect(result.originalAssessment.reason).toBe(assessment.reason);
  });

  it("uses specialist findings to select the next action", () => {
    const assessment = assessmentFor("authentication");
    const request = routeSpecialistReviews({
      assessment,
      telemetry: telemetryWith(repositorySignal("security-auth", [
        "auth login session permission secret public exposure",
      ])),
    }).requests[0];
    const finding: ReviewFinding = {
      severity: "warning",
      summary: "Authorization rules are not explicit.",
      evidence: ["permission checks missing"],
      recommendedAction: "Stop and decide",
    };

    const result = formatSpecialistReviewResult({
      request,
      findings: [finding],
      openQuestions: ["Who owns role assignment?"],
      originalAssessment: assessment,
    });

    expect(result.nextAction).toBe("Stop and decide");
    expect(result.openQuestions).toEqual(["Who owns role assignment?"]);
  });
});

function assessmentFor(
  concern: ArchitectureConcern,
  intervention: AssessmentResult["intervention"] = "recommend",
  action: AssessmentResult["action"] = "Run review",
): AssessmentResult {
  const question: BaselineQuestion = {
    id: `question-${concern}`,
    concern,
    kind: "choose",
    prompt: `Clarify ${concern}`,
    reason: `${concern} affects risk.`,
    relatedFactIds: [],
    relatedUnknownIds: [],
    relatedSignalIds: [],
    options: [],
  };
  return {
    status: action === "Continue" ? "ok" : "needs_attention",
    intervention,
    action,
    reason: `${concern} requires review.`,
    evidence: [{
      source: "fixture",
      summary: `${concern} evidence requires review.`,
    }],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    baseline: {
      repoRoot: process.cwd(),
      generatedAt: "2026-05-01T00:00:00.000Z",
      concerns: [concernFor(concern)],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    questions: action === "Continue" ? [] : [question],
    revisitAlerts: [],
    principleGuidance: [],
  };
}

function concernFor(concern: ArchitectureConcern): AssessmentResult["baseline"]["concerns"][number] {
  return {
    concern,
    currentState: "LoadBearing",
    confidence: "high",
    axes: {
      complexity: "high",
      irreversibility: "high",
      solutionVisibility: "medium",
      planningHorizon: "high",
    },
    thresholdCandidates: concern === "risk_hotspot" ? ["blast_radius"] : ["security"],
    facts: [{
      id: `fact-${concern}`,
      concern,
      label: `${concern} evidence`,
      status: "observed",
      confidence: "high",
      freshness: "current",
      sources: [{
        source: "fixture",
        category: "architecture_shape",
        status: "present",
        freshness: "current",
        confidence: "high",
      }],
      summary: `${concern} evidence requires specialist review.`,
    }],
    unknowns: [],
    rationale: `${concern} appears LoadBearing.`,
  };
}

function telemetryWith(...signals: SignalEnvelope<unknown>[]): ArchitecturalTelemetryBundle {
  return {
    lifecycle: [],
    repository: signals.filter((signal) => signal.family === "repository") as never,
    change: signals.filter((signal) => signal.family === "change") as never,
    test: [],
    memory: [],
    runtime: [],
    diagnostics: [],
  };
}

function repositorySignal(id: string, evidence: string[]): SignalEnvelope<unknown> {
  return signal(id, "repository", {
    category: "architecture_shape",
    repoRoot: process.cwd(),
    evidence,
  });
}

function changeSignal(id: string, evidence: string[]): SignalEnvelope<unknown> {
  return signal(id, "change", {
    category: "changed_file_spread",
    changedFiles: ["src/a.ts", "src/b.ts", "config/app.ts"],
    evidence,
  });
}

function signal(id: string, family: "repository" | "change", payload: unknown): SignalEnvelope<unknown> {
  return {
    id,
    family,
    source: "fixture",
    capturedAt: "2026-05-01T00:00:00.000Z",
    freshness: "current",
    confidence: "high",
    scope: family === "change" ? "change" : "repo",
    status: "present",
    correlationId: "corr-1",
    payload,
  };
}
