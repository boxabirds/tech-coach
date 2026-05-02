import { describe, expect, it } from "vitest";
import type { CaptureAssessmentResult } from "./types.js";
import {
  buildAssessmentGraph,
  createAssessmentIndex,
  createAssessmentOrientation,
  getAssessmentNode,
  queryAssessmentGraph,
} from "./assessmentGraph.js";

describe("assessment graph navigation", () => {
  it("builds a MECE graph with stable nodes and supported relationships", () => {
    const graph = buildAssessmentGraph(fixtureResult());

    expect(graph.counts).toMatchObject({
      run: 2,
      recommendation: 1,
      claim: 1,
      concern: 1,
      fact: 2,
      evidence: 2,
      question: 2,
      decision: 1,
      diagnostic: 1,
      artifact: 7,
    });
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "evidence:0", to: "claim:claim-auth-github", relation: "supports" }),
        expect.objectContaining({ from: "fact:auth.github-oauth.code.apps/web/src/routes/auth/github.ts", to: "claim:claim-auth-github", relation: "supports" }),
        expect.objectContaining({ from: "claim:claim-auth-github", to: "concern:authentication", relation: "supports" }),
        expect.objectContaining({ from: "concern:authentication", to: "question:question-auth-scope", relation: "raises_question" }),
        expect.objectContaining({ from: "claim:claim-auth-github", to: "artifact:latestAssessmentJson", relation: "stored_in" }),
        expect.objectContaining({ from: "run:run-current", to: "run:run-previous", relation: "supersedes" }),
        expect.objectContaining({ from: "decision:decision-auth", to: "artifact:decisionsJsonl", relation: "stored_in" }),
      ]),
    );
    expect(graph.edges.every((edge) =>
      graph.nodes.some((node) => node.id === edge.from)
        && graph.nodes.some((node) => node.id === edge.to)
    )).toBe(true);
  });

  it("pages through all nodes without duplicates or omissions", () => {
    const graph = buildAssessmentGraph(fixtureResult());
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = queryAssessmentGraph(graph, { limit: 4, cursor });
      seen.push(...page.items.map((node) => node.id));
      cursor = page.pageInfo.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(graph.nodes.length);
    expect(seen).toHaveLength(graph.nodes.length);
    expect(seen).toEqual(graph.nodes.map((node) => node.id));
  });

  it("filters by node type, concern, and relation", () => {
    const graph = buildAssessmentGraph(fixtureResult());

    expect(queryAssessmentGraph(graph, { nodeTypes: ["claim"] }).items.map((node) => node.id))
      .toEqual(["claim:claim-auth-github"]);
    expect(queryAssessmentGraph(graph, { nodeTypes: ["fact"] }).items.map((node) => node.id))
      .toEqual(expect.arrayContaining(["fact:auth.github-oauth.code.apps/web/src/routes/auth/github.ts"]));
    expect(queryAssessmentGraph(graph, { concerns: ["authentication"] }).items.map((node) => node.type))
      .toEqual(expect.arrayContaining(["claim", "concern", "fact", "question"]));
    expect(queryAssessmentGraph(graph, { relations: ["raises_question"] }).items.map((node) => node.id))
      .toEqual(expect.arrayContaining(["concern:authentication", "question:question-auth-scope"]));
  });

  it("rejects malformed or mismatched cursors", () => {
    const graph = buildAssessmentGraph(fixtureResult());
    const first = queryAssessmentGraph(graph, { nodeTypes: ["evidence"], limit: 1 });

    expect(() => queryAssessmentGraph(graph, { cursor: "not-json" })).toThrow("input.cursor");
    expect(() =>
      queryAssessmentGraph(graph, { nodeTypes: ["claim"], cursor: first.pageInfo.nextCursor })
    ).toThrow("does not match the requested graph filters");
  });

  it("loads node detail and paged edges for representative nodes", () => {
    const graph = buildAssessmentGraph(fixtureResult());
    const claim = getAssessmentNode(graph, {
      nodeId: "claim:claim-auth-github",
      edgeLimit: 2,
    });

    expect(claim.node.detail).toMatchObject({
      claim: "Web users authenticate through an external OAuth provider with server-side session state.",
    });
    expect(claim.edges).toHaveLength(2);
    expect(claim.pageInfo.hasNextPage).toBe(true);

    const allClaimEdges = [...claim.edges];
    let edgeCursor = claim.pageInfo.nextCursor;
    while (edgeCursor) {
      const next = getAssessmentNode(graph, {
        nodeId: "claim:claim-auth-github",
        edgeLimit: 2,
        edgeCursor,
      });
      allClaimEdges.push(...next.edges);
      edgeCursor = next.pageInfo.nextCursor;
    }
    expect(allClaimEdges.map((edge) => edge.relation)).toContain("stored_in");

    const question = getAssessmentNode(graph, { nodeId: "question:question-auth-scope" });
    expect(question.node.label).toBe("Authentication question");
    expect(question.node.label).not.toContain("question-auth-scope");
    expect(question.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "concern:authentication", relation: "raises_question" }),
      ]),
    );
  });

  it("pages normalized fact nodes with provenance intact", () => {
    const graph = buildAssessmentGraph(fixtureResult());
    const page = queryAssessmentGraph(graph, { nodeTypes: ["fact"], limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const detail = getAssessmentNode(graph, { nodeId: "fact:auth.session.code.apps/web/src/session.ts" });
    expect(detail.node.detail).toMatchObject({
      kind: "auth.session",
      provenance: [expect.objectContaining({ path: "apps/web/src/session.ts" })],
    });
    expect(detail.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "supports", to: "claim:claim-auth-github" }),
        expect.objectContaining({ relation: "stored_in", to: "artifact:evidenceJson" }),
      ]),
    );
  });

  it("returns empty pages as valid navigation results", () => {
    const graph = buildAssessmentGraph({
      ...fixtureResult(),
      assessment: {
        ...fixtureResult().assessment,
        claims: [],
        evidence: [],
        questions: [],
        baseline: {
          ...fixtureResult().assessment.baseline,
          concerns: [],
          facts: [],
          diagnostics: [],
        },
      },
      openQuestions: [],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      diagnostics: [],
    });

    const page = queryAssessmentGraph(graph, { nodeTypes: ["claim"] });
    expect(page.items).toEqual([]);
    expect(page.pageInfo).toMatchObject({ totalItems: 0, hasNextPage: false });
  });

  it("adds first-use orientation to the compact assessment index", () => {
    const firstRun = {
      ...fixtureResult(),
      previousRunId: undefined,
    };
    const index = createAssessmentIndex(firstRun);

    expect(index.orientation).toMatchObject({
      state: "first_use",
      shouldShowPreamble: true,
      preamble: {
        problem: expect.stringContaining("complexity evolves"),
        operation: expect.stringContaining("Claude handles the conversation"),
        storageModel: expect.stringContaining("durable local source of truth"),
      },
    });
    expect(index.orientation.preamble?.technologies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Claude Code skill"),
        expect.stringContaining("MCP tools"),
        expect.stringContaining("bun:sqlite"),
      ]),
    );
    expect(index.orientation.preamble?.engagement).toEqual(
      expect.arrayContaining([
        "first repository baseline",
        "pending change assessment",
        "lifecycle hook signals where configured",
      ]),
    );
    expect(index.orientation.artifactModel.generatedReports).toContainEqual(
      expect.objectContaining({
        name: "latest-assessment.md",
        description: "generated human-readable latest assessment report",
      }),
    );
  });

  it("suppresses the full preamble when existing context is present", () => {
    const orientation = createAssessmentOrientation(fixtureResult());

    expect(orientation).toMatchObject({
      state: "existing_context",
      shouldShowPreamble: false,
      repeatNote: expect.stringContaining("do not repeat the full preamble"),
    });
    expect(orientation.preamble).toBeUndefined();
  });

  it("does not claim durable context when capture is unavailable", () => {
    const orientation = createAssessmentOrientation({
      ...fixtureResult(),
      durableRecordCreated: false,
      previousRunId: undefined,
      lifecycleState: "unavailable",
      artifactPaths: undefined,
    });

    expect(orientation).toMatchObject({
      state: "unavailable",
      shouldShowPreamble: false,
      headline: expect.stringContaining("could not create durable"),
      repeatNote: expect.stringContaining("do not claim"),
    });
    expect(orientation.artifactModel.generatedReports.every((report) => !report.path)).toBe(true);
  });
});

function fixtureResult(): CaptureAssessmentResult {
  return {
    durableRecordCreated: true,
    storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    runId: "run-current",
    previousRunId: "run-previous",
    lifecycleState: "captured",
    artifactPaths: {
      latestAssessmentMd: "/repo/.ceetrix/tech-lead/latest-assessment.md",
      latestAssessmentJson: "/repo/.ceetrix/tech-lead/latest-assessment.json",
      questionsJson: "/repo/.ceetrix/tech-lead/questions.json",
      evidenceJson: "/repo/.ceetrix/tech-lead/evidence.json",
      nextActionsMd: "/repo/.ceetrix/tech-lead/next-actions.md",
      decisionsJsonl: "/repo/.ceetrix/tech-lead/decisions.jsonl",
      changesSinceLastMd: "/repo/.ceetrix/tech-lead/changes-since-last.md",
    },
    diagnostics: [{
      id: "diagnostic-info",
      severity: "info",
      source: "test",
      message: "Fixture diagnostic",
    }],
    telemetry: {
      lifecycle: [],
      repository: [{
        id: "signal-repository-test",
        family: "repository",
        source: "code-intelligence:tree-sitter",
        status: "present",
        freshness: "current",
        confidence: "high",
        scope: "repo",
        capturedAt: "2026-05-01T00:00:00.000Z",
        payload: {
          category: "architecture_claim",
          repoRoot: "/repo",
          evidence: [],
          details: {
            facts: [{
              id: "auth.github-oauth.code.apps/web/src/routes/auth/github.ts",
              concern: "authentication",
              family: "external_provider",
              kind: "auth.github_oauth",
              label: "GitHub OAuth code path",
              summary: "apps/web/src/routes/auth/github.ts contains GitHub OAuth implementation evidence.",
              source: "code-intelligence",
              confidence: "high",
              freshness: "current",
              provenance: [{ path: "apps/web/src/routes/auth/github.ts" }],
            }, {
              id: "auth.session.code.apps/web/src/session.ts",
              concern: "authentication",
              family: "session",
              kind: "auth.session",
              label: "server-side session code path",
              summary: "apps/web/src/session.ts contains session state implementation evidence.",
              source: "code-intelligence",
              confidence: "high",
              freshness: "current",
              provenance: [{ path: "apps/web/src/session.ts" }],
            }],
          },
        },
      }],
      change: [],
      test: [],
      memory: [],
      runtime: [],
      diagnostics: [],
    },
    openQuestions: [{
      id: "question-auth-scope",
      concern: "authentication",
      kind: "choose",
      prompt: "Which future security review should the authentication evidence guide?",
      reason: "Programmatic path evidence was detected.",
      relatedFactIds: [],
      relatedUnknownIds: [],
      relatedSignalIds: [],
      options: ["security review", "test coverage"],
    }],
    answeredQuestions: [{
      answerId: "answer-auth",
      questionId: "question-auth-confirmed",
      action: "confirm",
      value: "GitHub OAuth is production login.",
      recordedAt: "2026-05-01T00:00:00.000Z",
      status: "answered",
      runId: "run-current",
    }],
    skippedQuestions: [],
    decisions: [{
      id: "decision-auth",
      concern: "authentication",
      context: "Authentication decision",
      decision: "Use GitHub OAuth for web login.",
      alternatives: ["Keep ad hoc auth paths"],
      reason: "Existing implementation already uses GitHub OAuth and sessions.",
      risks: ["API auth scope remains unclear"],
      createdAt: "2026-05-01T00:00:00.000Z",
      state: "Owned",
      revisitIf: ["public API changes"],
      source: "user",
      runId: "run-current",
      confirmedAt: "2026-05-01T00:00:00.000Z",
    }],
    assessment: {
      status: "needs_attention",
      intervention: "recommend",
      action: "Add test harness",
      reason: "Authentication boundary needs protection.",
      evidence: [
        {
          family: "repository",
          source: "claim-candidate",
          category: "authentication",
          summary: "auth route: apps/web/src/routes/auth/github.ts",
          signalId: "signal-auth-route",
        },
        {
          family: "repository",
          source: "claim-candidate",
          category: "authentication",
          summary: "session storage: apps/web/src/session.ts",
          signalId: "signal-session",
        },
      ],
      doNotAdd: [],
      memory: { status: "absent", decisionCount: 0 },
      questions: [{
        id: "question-auth-scope",
        concern: "authentication",
        kind: "choose",
        prompt: "Which future security review should the authentication evidence guide?",
        reason: "Programmatic path evidence was detected.",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
        options: ["security review", "test coverage"],
      }],
      claims: [{
        id: "claim-auth-github",
        concern: "authentication",
        subject: "Web login",
        claim: "Web users authenticate through an external OAuth provider with server-side session state.",
        confidence: "high",
        evidenceNodeIds: ["signal-auth-route", "signal-session"],
        evidence: [
          "auth route: apps/web/src/routes/auth/github.ts",
          "session storage: apps/web/src/session.ts",
        ],
        counterEvidence: [],
        residualUnknowns: [],
      }],
      revisitAlerts: [],
      principleGuidance: [],
      baseline: {
        repoRoot: "/repo",
        generatedAt: "2026-05-01T00:00:00.000Z",
        diagnostics: [],
        unknowns: [],
        facts: [{
          id: "fact-auth",
          concern: "authentication",
          label: "Authentication is present",
          status: "observed",
          confidence: "high",
          freshness: "current",
          sources: [{
            source: "claim-candidate",
            category: "authentication",
            status: "present",
            freshness: "current",
            confidence: "high",
          }],
          summary: "Authentication exists through GitHub OAuth and sessions.",
        }],
        concerns: [{
          concern: "authentication",
          currentState: "LoadBearing",
          confidence: "high",
          axes: {
            complexity: "medium",
            irreversibility: "medium",
            solutionVisibility: "high",
            planningHorizon: "medium",
          },
          thresholdCandidates: ["identity"],
          facts: [{
            id: "fact-auth",
            concern: "authentication",
            label: "Authentication is present",
            status: "observed",
            confidence: "high",
            freshness: "current",
            sources: [{
              source: "claim-candidate",
              category: "authentication",
              status: "present",
              freshness: "current",
              confidence: "high",
            }],
            summary: "Authentication exists through GitHub OAuth and sessions.",
          }],
          unknowns: [],
          rationale: "Authentication is visible and load-bearing.",
        }],
      },
    },
  };
}
