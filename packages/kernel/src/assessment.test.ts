import { describe, expect, it } from "vitest";
import {
  assessArchitecture,
  AssessmentValidationError,
  normalizeAssessmentInput,
} from "./assessment.js";
import { telemetryFromEvidence } from "./telemetry.js";
import {
  brownfieldEvent,
  brownfieldEvidence,
} from "./__fixtures__/baseline/scenarios.js";
import { localStorageDecision, revisitEvent } from "./__fixtures__/memory/scenarios.js";

describe("assessArchitecture", () => {
  it("assesses legacy event input by converting it through telemetry", () => {
    const result = assessArchitecture({
      event: {
        ...brownfieldEvent,
        optionalSignals: brownfieldEvidence,
      },
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      intervention: "recommend",
      action: "Insert boundary",
      memory: { status: "absent", decisionCount: 0 },
    });
    expect(result.policy?.selected).toMatchObject({
      concern: "data_storage",
      action: "Insert boundary",
      patternId: "insert_repository_boundary",
      principleIds: expect.arrayContaining(["stable_contract", "right_sized_abstraction"]),
    });
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "repository",
          source: "layout",
          category: "file_layout",
        }),
      ]),
    );
  });

  it("assesses typed telemetry input and preserves signal citations", () => {
    const telemetry = telemetryFromEvidence({
      event: {
        ...brownfieldEvent,
        optionalSignals: brownfieldEvidence,
      },
      evidence: brownfieldEvidence,
      capturedAt: "2026-04-30T14:00:00.000Z",
      correlationId: "turn-cli",
    });

    const result = assessArchitecture({ telemetry });

    expect(result.baseline.repoRoot).toBe("/repo");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        family: "change",
        source: "imports",
        signalId: "change:imports:import_relationship",
      }),
    );
  });

  it("grounds authorization questions in repository security evidence", () => {
    const result = assessArchitecture({
      event: {
        host: "test",
        event: "brownfield-capture",
        cwd: "/repo",
        recentRequests: ["Assess repository security model"],
        changedFiles: [],
        repoSignals: { status: "present", evidence: ["known files: 20"] },
        memoryRefs: [],
        priorDecisions: [],
        optionalSignals: [{
          source: "claim-candidates",
          status: "present",
          category: "architecture_claim",
          freshness: "current",
          confidence: "high",
          evidence: [
            "authentication.route: authentication route: apps/web/src/pages/SignIn.tsx, workers/taskmgr/src/auth/web-oauth.ts",
            "authentication.external_provider: external identity provider: workers/taskmgr/src/auth/web-oauth.ts, workers/taskmgr/src/auth/github-access.ts",
            "authentication.session: server-side session: workers/taskmgr/src/auth/web-sessions.ts, workers/taskmgr/src/mcp/session.ts",
            "authentication.credential: API key or token authentication: workers/taskmgr/src/auth/token-utils.ts, scripts/setup-api-key.sh",
            "authorization.authorization: role or membership boundary: workers/taskmgr/src/auth/membership.ts, workers/taskmgr/src/auth/membership.test.ts, workers/taskmgr/migrations/0051_user_projects_role.sql, workers/taskmgr/tests/db/user-projects.test.ts",
          ],
        }],
      },
    });
    const prompts = result.questions.map((question) => question.prompt).join("\n");

    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authorization",
          confidence: "high",
          claim: expect.stringContaining("Project membership and role boundaries"),
        }),
      ]),
    );
    expect(prompts).toContain("Project membership and role boundaries");
    expect(prompts).not.toContain("Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions?");
  });

  it("keeps broad authorization setup questions when assessment evidence is sparse", () => {
    const result = assessArchitecture({
      event: {
        host: "test",
        event: "brownfield-capture",
        cwd: "/repo",
        recentRequests: ["Assess repository"],
        changedFiles: [],
        repoSignals: { status: "present", evidence: ["known files: 3"] },
        memoryRefs: [],
        priorDecisions: [],
        optionalSignals: [],
      },
    });
    const authorization = result.questions.find((question) => question.concern === "authorization");

    expect((result.claims ?? []).filter((claim) => claim.concern === "authorization")).toEqual([]);
    expect(authorization?.prompt).toBe("What authorization or role boundary should the coach assume for this project right now?");
  });

  it("returns revisit alerts when project memory conditions match current work", () => {
    const result = assessArchitecture({
      event: revisitEvent,
      memoryRecords: [localStorageDecision],
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      intervention: "decision-required",
      action: "Replace substrate",
      memory: { status: "loaded", decisionCount: 1 },
    });
    expect(result.policy?.selected).toMatchObject({
      concern: "data_storage",
      intervention: "decision-required",
      thresholdCandidates: expect.arrayContaining(["revisit", "persistence"]),
    });
    expect(result.revisitAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: "decision-localstorage-projects",
          matchedCondition: "sharing",
        }),
      ]),
    );
  });

  it("rejects telemetry input without lifecycle context", () => {
    expect(() =>
      normalizeAssessmentInput({
        lifecycle: [],
        repository: [],
        change: [],
        test: [],
        memory: [],
        runtime: [],
        diagnostics: [],
      }),
    ).toThrow(AssessmentValidationError);
  });
});
