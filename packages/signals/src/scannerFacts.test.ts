import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configBoundaryProvider } from "./config.js";
import { documentationProvider } from "./documentation.js";
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

  it("does not treat non-authorization role labels as authorization facts", () => {
    const repo = tempRepo({
      "docs/adr/010-pbr-material-skins.md": `
| Material | Credits | Relative | Game Role |
| --- | --- | --- | --- |
| Ice | 1 | 1x | Common, early game staple |
| Gold | 100 | 100x | Rare, objective material |
`,
    });

    const result = documentationProvider.collect(context(repo, [
      "docs/adr/010-pbr-material-skins.md",
    ])) as OptionalSignalResult;

    expect((result.facts ?? []).map((fact) => fact.kind)).not.toContain("authz.membership_role");
    expect(result.evidence.join("\n")).not.toContain("authorization");
  });

  it("still recognizes role documentation when it has access-control context", () => {
    const repo = tempRepo({
      "docs/security/access.md": "Authenticated users can have admin and editor roles for project resources.",
    });

    const result = documentationProvider.collect(context(repo, [
      "docs/security/access.md",
    ])) as OptionalSignalResult;

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "authz.membership_role" }),
      ]),
    );
  });

  it("treats canonical design architecture docs as high-priority architecture evidence", () => {
    const repo = tempRepo({
      "docs/design/tech-architecture.md": "# Tech Architecture\n\nCanonical MVP tech stack and material pipeline.",
      "docs/adr/001-old-choice.md": "# ADR\n\nArchitecture decision record.",
    });

    const result = documentationProvider.collect(context(repo, [
      "docs/adr/001-old-choice.md",
      "docs/design/tech-architecture.md",
    ])) as OptionalSignalResult;

    expect(result.details?.documentsRead).toEqual([
      "docs/design/tech-architecture.md",
      "docs/adr/001-old-choice.md",
    ]);
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concern: "application_shape",
          kind: "doc.architecture",
          confidence: "high",
          timeframe: "future",
          role: "architecture_basis",
          provenance: [expect.objectContaining({ path: "docs/design/tech-architecture.md" })],
        }),
      ]),
    );
    expect(result.details?.temporalEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/design/tech-architecture.md",
          timeframe: "future",
          role: "architecture_basis",
        }),
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

  it("classifies POC inventory as past experiment evidence", () => {
    const repo = tempRepo({
      "pocs/old-flight-lab/package.json": "{}",
      "src/main.ts": "export const current = true;",
      "tests/current.test.ts": "test('current', () => {});",
    });
    const inventory = buildProjectInventory(repo, 50);
    const result = inventoryProvider.collect({ ...context(repo, inventory.files), inventory }) as OptionalSignalResult;

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "inventory.file",
          provenance: [expect.objectContaining({ path: "pocs/old-flight-lab/package.json" })],
          timeframe: "past",
          role: "experiment",
        }),
        expect.objectContaining({
          kind: "inventory.file",
          provenance: [expect.objectContaining({ path: "src/main.ts" })],
          timeframe: "current",
          role: "implementation",
        }),
        expect.objectContaining({
          kind: "inventory.file",
          provenance: [expect.objectContaining({ path: "tests/current.test.ts" })],
          timeframe: "current",
          role: "test_evidence",
        }),
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
