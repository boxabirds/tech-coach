import { describe, expect, it } from "vitest";
import { compareClaims, type BrownfieldClaimBaseline } from "./claimComparator.js";
import type { ArchitectureClaim } from "../../kernel/src/claimTypes.js";

const baseline: BrownfieldClaimBaseline = {
  name: "claude-backlog",
  path: "/repo",
  requiredClaims: [{
    concern: "authentication",
    claimContains: ["GitHub OAuth", "session"],
    evidenceContains: ["web-oauth.ts"],
  }, {
    concern: "authorization",
    claimContains: ["Project membership", "role"],
    evidenceContains: ["membership.ts", "0051_user_projects_role.sql"],
  }],
  requiredResidualQuestions: [
    "API-key or MCP session authentication",
    "Which detected role, membership, or permission rule",
  ],
  requiredFacts: [{
    concern: "authentication",
    kindContains: "auth.github_oauth",
    provenanceContains: "web-oauth.ts",
  }],
  forbiddenQuestions: [
    "Which identity boundary should the coach assume",
    "Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions",
  ],
  forbiddenEvidence: ["chrome_profile"],
};

describe("claimComparator", () => {
  it("passes when claims, evidence, and residual questions match the manual baseline", () => {
    const result = compareClaims(baseline, {
      claims: [
        claim("authentication", "Web users authenticate through GitHub OAuth with server-side session state.", ["workers/taskmgr/src/auth/web-oauth.ts"]),
        claim("authorization", "Project membership and role boundaries are visible and should be treated as load-bearing authorization.", [
          "workers/taskmgr/src/auth/membership.ts",
          "workers/taskmgr/migrations/0051_user_projects_role.sql",
        ]),
      ],
      questions: [{
        id: "q",
        concern: "authentication",
        kind: "choose",
        prompt: "Whether API-key or MCP session authentication is production, CLI-only, or legacy.",
        reason: "residual",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }, {
        id: "q-authz",
        concern: "authorization",
        kind: "choose",
        prompt: "Which detected role, membership, or permission rule is load-bearing for the next test harness.",
        reason: "residual",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      evidenceText: [
        "workers/taskmgr/src/auth/web-oauth.ts",
        "workers/taskmgr/src/auth/membership.ts",
        "workers/taskmgr/migrations/0051_user_projects_role.sql",
      ],
      facts: [{
        concern: "authentication",
        kind: "auth.github_oauth",
        summary: "GitHub OAuth code path",
        provenance: [{ path: "workers/taskmgr/src/auth/web-oauth.ts" }],
      }],
    });

    expect(result).toMatchObject({ passed: true, failures: [] });
  });

  it("fails on the original lazy broad authentication question", () => {
    const result = compareClaims(baseline, {
      claims: [],
      questions: [{
        id: "q",
        concern: "authentication",
        kind: "choose",
        prompt: "Which identity boundary should the coach assume: no auth, local-only user, session login, or external identity provider?",
        reason: "generic",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      evidenceText: [],
      facts: [],
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.category)).toEqual(
      expect.arrayContaining(["missing_claim", "missing_question", "forbidden_question"]),
    );
  });

  it("fails on the lazy broad authorization taxonomy question when authz evidence is required", () => {
    const result = compareClaims(baseline, {
      claims: [claim("authorization", "Repository evidence shows role, membership, or permission boundaries.", [
        "workers/taskmgr/src/auth/membership.ts",
      ])],
      questions: [{
        id: "q-authz",
        concern: "authorization",
        kind: "choose",
        prompt: "Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions?",
        reason: "generic",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      evidenceText: ["workers/taskmgr/src/auth/membership.ts"],
      facts: [],
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.category)).toEqual(
      expect.arrayContaining(["missing_claim", "missing_question", "forbidden_question"]),
    );
  });

  it("fails when noisy generated evidence supports a claim", () => {
    const result = compareClaims(baseline, {
      claims: [claim("authentication", "Web users authenticate through GitHub OAuth with server-side session state.", [
        "docs/chrome_profile/Default/Code Cache/wasm/index",
      ])],
      questions: [{
        id: "q",
        concern: "authentication",
        kind: "choose",
        prompt: "Whether API-key or MCP session authentication is production, CLI-only, or legacy.",
        reason: "residual",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      evidenceText: [],
      facts: [{
        concern: "authentication",
        kind: "auth.github_oauth",
        summary: "GitHub OAuth code path",
        provenance: [{ path: "workers/taskmgr/src/auth/web-oauth.ts" }],
      }],
    });

    expect(result.failures.map((failure) => failure.category)).toContain("forbidden_evidence");
  });
});

function claim(
  concern: ArchitectureClaim["concern"],
  text: string,
  evidence: string[],
): ArchitectureClaim {
  return {
    id: `claim-${concern}`,
    concern,
    subject: concern,
    claim: text,
    confidence: "high",
    evidenceNodeIds: [],
    evidence,
    counterEvidence: [],
    residualUnknowns: [],
  };
}
