import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configBoundaryProvider } from "./config.js";
import { documentationProvider } from "./documentation.js";
import { staticCodeIntelligenceProvider } from "./codeIntelligence.js";
import { buildProjectInventory, inventoryProvider } from "./inventory.js";
import type { OptionalSignalResult, SignalContext } from "./index.js";

describe("scanner fact extraction", () => {
  it("extracts deployment environments and bindings from structured config", () => {
    const repo = tempRepo({
      "workers/taskmgr/wrangler.toml.example": `
name = "taskmgr"
main = "src/index.ts"

[[d1_databases]]
binding = "DB"

[[kv_namespaces]]
binding = "SESSION_KV"

[env.staging]
name = "taskmgr-staging"

[env.production]
name = "taskmgr-production"
`,
      "package.json": JSON.stringify({
        scripts: {
          test: "vitest run",
          "deploy:production": "wrangler deploy --env production",
        },
        devDependencies: { wrangler: "^4.0.0" },
      }),
      "scripts/deploy-production.sh": "wrangler deploy --env production",
    });

    const result = configBoundaryProvider.collect(context(repo, [
      "workers/taskmgr/wrangler.toml.example",
      "package.json",
      "scripts/deploy-production.sh",
    ])) as OptionalSignalResult;

    expect(result.status).toBe("present");
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ concern: "deployment", kind: "deployment.environment", summary: expect.stringContaining("staging") }),
        expect.objectContaining({ concern: "deployment", kind: "deployment.environment", summary: expect.stringContaining("production") }),
        expect.objectContaining({ concern: "data_storage", kind: "binding.d1" }),
        expect.objectContaining({ concern: "authentication", kind: "binding.kv" }),
      ]),
    );
    expect(result.evidence.join("\n")).toContain("wrangler.toml.example");
  });

  it("reads bounded docs into deployment and security facts", () => {
    const repo = tempRepo({
      "docs/self-hosting.md": "Deploy to Cloudflare Workers. Local, staging, and production environments use Wrangler.",
      "docs/ops/staging.md": "Staging deployment verifies GitHub OAuth, sessions, roles, D1, and migrations.",
      "docs/research/noise.md": "Ignore this production deployment note because it is research.",
    });

    const result = documentationProvider.collect(context(repo, [
      "docs/self-hosting.md",
      "docs/ops/staging.md",
      "docs/research/noise.md",
    ])) as OptionalSignalResult;

    expect(result.status).toBe("present");
    expect(result.facts?.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(["doc.runbook", "deployment.environment", "auth.github_oauth", "authz.membership_role", "binding.d1"]),
    );
    expect(result.evidence.join("\n")).toContain("docs/ops/staging.md");
    expect(result.evidence.join("\n")).not.toContain("docs/research/noise.md");
  });

  it("extracts code facts without needing a language-specific auth extractor", () => {
    const repo = tempRepo({
      "workers/taskmgr/src/auth/web-oauth.ts": "export async function githubOAuth() { return await fetch('https://github.com/login/oauth/access_token') }",
      "workers/taskmgr/src/auth/web-sessions.ts": "export function createSession(env) { return env.SESSION_KV.put('session', 'cookie', { httpOnly: true }) }",
      "workers/taskmgr/src/auth/membership.ts": "export function requireRole(userProjects, role) { return userProjects.some((p) => p.role === role) }",
      "workers/taskmgr/src/index.ts": "import { githubOAuth } from './auth/web-oauth'; export default { fetch() { return githubOAuth(); } }",
      "workers/taskmgr/src/auth/membership.test.ts": "import { expect, test } from 'vitest'; test('roles', () => expect(true).toBe(true));",
    });

    const results = staticCodeIntelligenceProvider.collect(context(repo, [
      "workers/taskmgr/src/auth/web-oauth.ts",
      "workers/taskmgr/src/auth/web-sessions.ts",
      "workers/taskmgr/src/auth/membership.ts",
      "workers/taskmgr/src/index.ts",
      "workers/taskmgr/src/auth/membership.test.ts",
    ])) as OptionalSignalResult[];
    const facts = results.flatMap((result) => result.facts ?? []);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "auth.github_oauth", concern: "authentication" }),
        expect.objectContaining({ kind: "auth.session", concern: "authentication" }),
        expect.objectContaining({ kind: "authz.membership_role", concern: "authorization" }),
        expect.objectContaining({ kind: "deployment.runtime", concern: "deployment" }),
        expect.objectContaining({ kind: "test.surface", concern: "testing" }),
      ]),
    );
  });

  it("makes inventory inclusion and noise exclusion explicit", () => {
    const repo = tempRepo({
      "src/index.ts": "export const value = 1;",
      "node_modules/pkg/index.js": "generated",
      ".ceetrix/tech-lead/latest-assessment.json": "{}",
      "docs/self-hosting.md": "Deploy to production",
    });
    const inventory = buildProjectInventory(repo, 50);
    const result = inventoryProvider.collect({ ...context(repo, inventory.files), inventory }) as OptionalSignalResult;

    expect(inventory.files).toContain("src/index.ts");
    expect(inventory.files).toContain("docs/self-hosting.md");
    expect(inventory.excluded.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["node_modules/pkg", ".ceetrix"]),
    );
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inventory.file", summary: expect.stringContaining("docs/self-hosting.md") }),
        expect.objectContaining({ kind: "inventory.excluded", summary: expect.stringContaining("dependency install") }),
      ]),
    );
  });
});

function context(cwd: string, knownFiles: string[]): SignalContext {
  return {
    cwd,
    knownFiles,
    changedFiles: [],
    recentRequests: [],
  };
}

function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tech-coach-scanners-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return root;
}
