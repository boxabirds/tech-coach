import { describe, expect, it } from "vitest";
import { assessArchitecture } from "./assessment.js";
import {
  buildArchitectureEvidenceGraph,
  inferArchitectureClaims,
} from "./claims.js";
import { telemetryFromEvidence } from "./telemetry.js";
import type { CoachEventEnvelope } from "./protocol.js";
import type { ArchitectureEvidenceFact } from "./claimTypes.js";

describe("architecture claims", () => {
  it("infers high-confidence external OAuth plus server-side session claims from corroborated evidence", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authentication.route: authentication route: apps/web/src/pages/SignIn.tsx",
        "authentication.external_provider: external identity provider: workers/taskmgr/src/auth/web-oauth.ts, workers/taskmgr/src/auth/github-urls.ts",
        "authentication.session: server-side session: workers/taskmgr/src/auth/web-sessions.ts, workers/taskmgr/src/mcp/session.ts",
        "authentication.credential: API key or token authentication: workers/taskmgr/src/auth/token-utils.ts",
      ]),
    });

    const graph = buildArchitectureEvidenceGraph(telemetry);
    const claims = inferArchitectureClaims(graph);

    expect(graph.nodes.map((node) => node.family)).toEqual(
      expect.arrayContaining(["route", "external_provider", "session", "credential"]),
    );
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authentication",
          confidence: "high",
          claim: "Web users authenticate through an external OAuth provider with server-side session state.",
          evidence: expect.arrayContaining([
            "workers/taskmgr/src/auth/web-sessions.ts",
          ]),
        }),
      ]),
    );
  });

  it("keeps every required evidence family represented when one family has many candidates", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authentication.route: authentication route: apps/web/src/pages/SignIn.tsx, workers/admin/src/frontend/pages/Login.tsx, workers/taskmgr/src/auth/config.ts",
        "authentication.external_provider: external identity provider: workers/taskmgr/src/auth/github-access.ts, workers/taskmgr/src/auth/github-jwt.ts, workers/taskmgr/src/auth/github-urls.ts, workers/taskmgr/src/auth/web-oauth.ts, workers/taskmgr/src/notifications/github-auth-alert.ts, workers/taskmgr/src/auth/github-access.test.ts, workers/taskmgr/src/auth/github-jwt.test.ts, workers/taskmgr/src/auth/web-oauth.test.ts",
        "authentication.session: server-side session: workers/taskmgr/src/auth/web-sessions.ts, workers/taskmgr/src/mcp/session.ts",
      ]),
    });

    const webClaim = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry))
      .find((claim) => claim.subject === "web user authentication");

    expect(webClaim).toMatchObject({
      claim: "Web users authenticate through an external OAuth provider with server-side session state.",
      evidence: expect.arrayContaining([
        "apps/web/src/pages/SignIn.tsx",
        "workers/taskmgr/src/auth/web-oauth.ts",
        "workers/taskmgr/src/auth/web-sessions.ts",
      ]),
    });
  });

  it("does not promote single weak keyword evidence to a concrete claim", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "random note mentions auth in a README",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims.filter((claim) => claim.concern === "authentication")).toEqual([]);
  });

  it("does not create package-boundary claims from POC package files alone", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "changed file: pocs/am-ship-5-scout-skiff-jets/package.json",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims.filter((claim) => claim.concern === "package_boundary")).toEqual([]);
  });

  it("still recognizes real workspace package boundaries", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "package_boundary.package_boundary: package or workspace boundary: packages/audio-engine/package.json, packages/audio-engine/src/index.ts",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "package_boundary",
        }),
      ]),
    );
  });

  it("infers specific high-confidence authorization claims from membership, role, and test evidence", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authorization.authorization: role or membership boundary: workers/taskmgr/src/auth/membership.ts, workers/taskmgr/src/auth/membership.test.ts, workers/taskmgr/migrations/0051_user_projects_role.sql, workers/taskmgr/tests/db/user-projects.test.ts",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authorization",
          confidence: "high",
          claim: "Membership and role boundaries are visible and should be treated as load-bearing authorization.",
          residualUnknowns: [
            "Which future access-control change or risk should guide the next architecture review.",
          ],
        }),
      ]),
    );
  });

  it("infers resource-level authorization claims from permission evidence", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authorization.authorization: resource permission boundary: apps/api/src/permissions/resourcePermissions.ts, apps/api/src/permissions/resourcePermissions.test.ts",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authorization",
          confidence: "high",
          claim: "Resource-level permission boundaries are visible and should be treated as load-bearing authorization.",
        }),
      ]),
    );
  });

  it("does not convert sparse generic authorization mentions into concrete claims", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authorization may be needed later",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims.filter((claim) => claim.concern === "authorization")).toEqual([]);
  });

  it("does not promote documentation-only role labels into authorization claims", () => {
    const telemetry = telemetryFromEvidence({
      event: eventWithEvidence([
        "authorization.authorization: authorization documentation: docs/adr/010-pbr-material-skins.md",
      ]),
    });

    const claims = inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));

    expect(claims.filter((claim) => claim.concern === "authorization")).toEqual([]);
  });

  it("suppresses broad authentication interview questions when a claim already answers them", () => {
    const result = assessArchitecture({
      event: eventWithEvidence([
        "authentication.route: authentication route: apps/web/src/pages/SignIn.tsx",
        "authentication.external_provider: external identity provider: workers/taskmgr/src/auth/web-oauth.ts, workers/taskmgr/src/auth/github-urls.ts",
        "authentication.session: server-side session: workers/taskmgr/src/auth/web-sessions.ts, workers/taskmgr/src/mcp/session.ts",
        "authentication.credential: API key or token authentication: workers/taskmgr/src/auth/token-utils.ts",
        "package_boundary.package_boundary: package or workspace boundary: apps/web/src/App.tsx, workers/taskmgr/src/index.ts",
      ]),
    });

    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authentication",
          confidence: "high",
        }),
      ]),
    );
    expect(result.questions.map((question) => question.prompt).join("\n"))
      .not.toContain("Which identity boundary should the coach assume");
    expect(result.questions.map((question) => question.prompt).join("\n"))
      .not.toContain("API-key or MCP session authentication");
  });

  it("asks future-risk authorization questions instead of broad taxonomy questions when authz evidence exists", () => {
    const result = assessArchitecture({
      event: {
        ...eventWithEvidence([
        "authentication.route: authentication route: apps/web/src/pages/SignIn.tsx",
        "authentication.external_provider: external identity provider: workers/taskmgr/src/auth/web-oauth.ts, workers/taskmgr/src/auth/github-urls.ts",
        "authentication.session: server-side session: workers/taskmgr/src/auth/web-sessions.ts, workers/taskmgr/src/mcp/session.ts",
        "authorization.authorization: role or membership boundary: workers/taskmgr/src/auth/membership.ts, workers/taskmgr/src/auth/membership.test.ts, workers/taskmgr/migrations/0051_user_projects_role.sql, workers/taskmgr/tests/db/user-projects.test.ts",
        ]),
        userRequest: "Review authorization risk before adding access-control changes.",
      },
    });
    const prompts = result.questions.map((question) => question.prompt).join("\n");

    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authorization",
          confidence: "high",
          claim: expect.stringContaining("Membership and role boundaries"),
        }),
      ]),
    );
    expect(prompts).toContain("Which future access-control change or risk should guide the next architecture review");
    expect(prompts).not.toContain("Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions?");
    expect(prompts).not.toContain("workers/taskmgr");
  });

  it("promotes normalized config, doc, and code facts into concrete deployment claims", () => {
    const result = assessArchitecture({
      event: {
        ...eventWithFacts([
        fact("deployment.environment.production", "deployment", "deployment_config", "deployment.environment", "Cloudflare production environment", "Cloudflare Workers has a configured production environment.", "workers/taskmgr/wrangler.toml.example"),
        fact("deployment.environment.staging.docs", "deployment", "deployment_config", "deployment.environment", "staging deployment documentation", "Bounded documentation describes staging deployment environment.", "docs/ops/staging.md"),
        fact("deployment.script.production", "deployment", "deployment_config", "deployment.script", "deployment script", "Deployment script references production environment.", "scripts/deploy-production.sh"),
        fact("deployment.runtime.worker", "deployment", "deployment_config", "deployment.runtime", "Cloudflare Workers runtime", "Cloudflare Workers runtime is configured.", "workers/taskmgr/wrangler.toml.example"),
        ]),
        userRequest: "Plan production deployment hardening.",
      },
    });
    const prompts = result.questions.map((question) => question.prompt).join("\n");

    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "deployment",
          confidence: "high",
          claim: expect.stringContaining("Deployment evidence includes"),
        }),
      ]),
    );
    expect(result.claims?.find((claim) => claim.concern === "deployment")?.evidence).toEqual(
      expect.arrayContaining([
        "workers/taskmgr/wrangler.toml.example",
        "docs/ops/staging.md",
        "scripts/deploy-production.sh",
      ]),
    );
    expect(prompts).toContain("Which rollout risk should guide the next operational check");
    expect(prompts).not.toContain("Should the coach assume local-only use, private hosting, public hosting, or production service deployment");
  });
});

function eventWithEvidence(evidence: string[]): CoachEventEnvelope {
  return {
    host: "test",
    event: "brownfield-capture",
    cwd: "/repo",
    recentRequests: ["Assess this repository"],
    changedFiles: [],
    repoSignals: {
      status: "present",
      evidence: ["known files: 10"],
    },
    memoryRefs: [],
    priorDecisions: [],
    optionalSignals: [{
      source: "claim-candidates",
      status: "present",
      category: "architecture_claim",
      freshness: "current",
      confidence: "high",
      evidence,
    }],
  };
}

function eventWithFacts(facts: ArchitectureEvidenceFact[]): CoachEventEnvelope {
  return {
    host: "test",
    event: "brownfield-capture",
    cwd: "/repo",
    recentRequests: ["Assess this repository"],
    changedFiles: [],
    repoSignals: {
      status: "present",
      evidence: ["known files: 10"],
    },
    memoryRefs: [],
    priorDecisions: [],
    optionalSignals: [{
      source: "config-boundary",
      status: "present",
      category: "configuration_boundary",
      freshness: "current",
      confidence: "high",
      evidence: facts.map((item) =>
        `${item.concern}.${item.family}: ${item.label}: ${item.provenance.map((entry) => entry.path).join(", ")}`
      ),
      facts,
    }],
  };
}

function fact(
  id: string,
  concern: ArchitectureEvidenceFact["concern"],
  family: ArchitectureEvidenceFact["family"],
  kind: ArchitectureEvidenceFact["kind"],
  label: string,
  summary: string,
  path: string,
): ArchitectureEvidenceFact {
  return {
    id,
    concern,
    family,
    kind,
    label,
    summary,
    source: "test",
    confidence: "high",
    freshness: "current",
    provenance: [{ path }],
  };
}
