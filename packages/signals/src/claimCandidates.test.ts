import { describe, expect, it } from "vitest";
import { claimCandidateProvider } from "./claimCandidates.js";
import type { OptionalSignalResult, SignalContext } from "./index.js";

const baseContext: SignalContext = {
  cwd: "/repo",
  changedFiles: [],
  recentRequests: [],
};

describe("claimCandidateProvider", () => {
  it("extracts corroborating auth and session candidates from whole-repository file lists", () => {
    const result = claimCandidateProvider.collect({
      ...baseContext,
      knownFiles: [
        "apps/web/src/pages/SignIn.tsx",
        "workers/taskmgr/src/auth/web-oauth.ts",
        "workers/taskmgr/src/auth/web-sessions.ts",
        "workers/taskmgr/src/auth/token-utils.ts",
        "workers/taskmgr/src/mcp/session.ts",
        "workers/taskmgr/src/auth/membership.ts",
        "workers/taskmgr/src/auth/membership.test.ts",
        "workers/taskmgr/tests/db/user-projects.test.ts",
        "workers/taskmgr/migrations/0051_user_projects_role.sql",
        "workers/taskmgr/wrangler.toml",
      ],
    }) as OptionalSignalResult;

    expect(result).toMatchObject({
      source: "claim-candidates",
      status: "present",
      category: "architecture_claim",
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("authentication.route"),
        expect.stringContaining("authentication.external_provider"),
        expect.stringContaining("authentication.session"),
        expect.stringContaining("authentication.credential"),
        expect.stringContaining("authorization.authorization"),
        expect.stringContaining("data_storage.schema"),
        expect.stringContaining("deployment.deployment_config"),
      ]),
    );
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "authentication",
          kind: "auth.github_oauth",
          provenance: [{ path: "workers/taskmgr/src/auth/web-oauth.ts" }],
        }),
        expect.objectContaining({
          concern: "authentication",
          kind: "auth.credential",
          provenance: [{ path: "workers/taskmgr/src/auth/token-utils.ts" }],
        }),
        expect.objectContaining({
          concern: "authorization",
          kind: "authz.membership_role",
          provenance: [{ path: "workers/taskmgr/src/auth/membership.ts" }],
        }),
      ]),
    );
  });

  it("keeps authorization evidence concrete enough to ground interview questions", () => {
    const result = claimCandidateProvider.collect({
      ...baseContext,
      knownFiles: [
        "workers/taskmgr/src/auth/membership.ts",
        "workers/taskmgr/src/auth/membership.test.ts",
        "workers/taskmgr/migrations/0051_user_projects_role.sql",
        "workers/taskmgr/tests/db/user-projects.test.ts",
      ],
    }) as OptionalSignalResult;
    const evidence = result.evidence.join("\n");

    expect(evidence).toContain("authorization.authorization");
    expect(evidence).toContain("membership.ts");
    expect(evidence).toContain("membership.test.ts");
    expect(evidence).toContain("0051_user_projects_role.sql");
    expect(evidence).toContain("user-projects.test.ts");
  });

  it("ignores generated browser cache paths as claim candidates", () => {
    const result = claimCandidateProvider.collect({
      ...baseContext,
      knownFiles: [
        "docs/marketing/ops/data/verify-claims/chrome_profile/Default/Code Cache/wasm/index",
        "ScreencapMenuBar/Package.swift",
        "ScreencapMenuBar/Sources/AIMetadataService.swift",
      ],
    }) as OptionalSignalResult;

    expect(result.evidence.join("\n")).toContain("package_boundary.package_boundary");
    expect(result.evidence.join("\n")).not.toContain("chrome_profile");
    expect(result.evidence.join("\n")).not.toContain("Code Cache");
    expect(JSON.stringify(result.facts)).not.toContain("chrome_profile");
  });
});
