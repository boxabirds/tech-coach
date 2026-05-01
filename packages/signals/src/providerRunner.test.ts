import { describe, expect, it } from "vitest";
import type { OptionalSignalProvider, SignalContext } from "./index.js";
import { configBoundaryProvider } from "./config.js";
import { diagnosticsProvider } from "./diagnostics.js";
import { fileTreeProvider } from "./fileTree.js";
import { gitDiffProvider } from "./gitDiff.js";
import { runOptionalSignalProviders } from "./providerRunner.js";
import { runtimeProvider } from "./runtime.js";

const context: SignalContext = {
  cwd: "/repo",
  changedFiles: [
    "src/pages/ProjectEditor.tsx",
    "src/lib/projectStorage.ts",
    "package.json",
  ],
  knownFiles: [
    "src/pages/ProjectEditor.tsx",
    "src/lib/projectStorage.ts",
    "package.json",
    "tests/projectStorage.test.ts",
  ],
  recentRequests: ["Add saved projects", "Add project tags"],
  testSummary: {
    status: "not_run",
    summary: "Tests were not run",
  },
  diagnostics: ["tsc reports no errors"],
  runtimeErrors: ["ReferenceError in ProjectEditor after save"],
  monitorEvents: ["monitor: repeated save latency warning"],
};

describe("runOptionalSignalProviders", () => {
  it("normalizes built-in optional providers into typed telemetry families", async () => {
    const result = await runOptionalSignalProviders(
      context,
      [
        fileTreeProvider,
        gitDiffProvider,
        configBoundaryProvider,
        diagnosticsProvider,
        runtimeProvider,
      ],
      {
        capturedAt: "2026-05-01T09:00:00.000Z",
        correlationId: "turn-provider",
      },
    );

    expect(result.telemetry.repository).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "file-tree" }),
        expect.objectContaining({ source: "config-boundary" }),
      ]),
    );
    expect(result.telemetry.change).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "git-diff" }),
      ]),
    );
    expect(result.telemetry.test).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "diagnostics" }),
      ]),
    );
    expect(result.telemetry.runtime).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "runtime" }),
      ]),
    );
  });

  it("records absent, failed, malformed, duplicate, stale, and unsupported provider evidence without blocking telemetry", async () => {
    const absentProvider: OptionalSignalProvider = {
      name: "absent-provider",
      collect: () => undefined,
    };
    const failedProvider: OptionalSignalProvider = {
      name: "failed-provider",
      collect: () => {
        throw new Error("provider unavailable");
      },
    };
    const malformedProvider: OptionalSignalProvider = {
      name: "malformed-provider",
      collect: () => ({ nope: true }) as never,
    };
    const duplicateProvider: OptionalSignalProvider = {
      name: "duplicate-provider",
      collect: () => [
        {
          source: "dup",
          status: "present",
          category: "symbol_reference",
          freshness: "stale",
          confidence: "medium",
          evidence: ["ProjectEditor calls saveProject"],
        },
        {
          source: "dup",
          status: "present",
          category: "symbol_reference",
          freshness: "stale",
          confidence: "medium",
          evidence: ["ProjectEditor calls saveProject"],
        },
      ],
    };
    const unsupportedProvider: OptionalSignalProvider = {
      name: "unsupported-provider",
      collect: () => ({
        source: "unsupported",
        status: "present",
        category: "unsupported-layout",
        freshness: "current",
        confidence: "high",
        evidence: ["not part of the shared category vocabulary"],
      }) as never,
    };
    const familyMismatchProvider: OptionalSignalProvider = {
      name: "family-mismatch-provider",
      collect: () => ({
        source: "family-mismatch",
        status: "present",
        category: "runtime_error",
        family: "repository",
        freshness: "current",
        confidence: "high",
        evidence: ["runtime error reported as repository evidence"],
      }),
    };

    const result = await runOptionalSignalProviders(
      context,
      [
        absentProvider,
        failedProvider,
        malformedProvider,
        duplicateProvider,
        unsupportedProvider,
        familyMismatchProvider,
      ],
      { capturedAt: "2026-05-01T09:00:00.000Z" },
    );

    expect(result.telemetry.change[0]).toMatchObject({
      source: "dup",
      freshness: "stale",
    });
    expect(result.telemetry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "absent-provider" }),
        expect.objectContaining({ source: "failed-provider" }),
        expect.objectContaining({ source: "malformed-provider" }),
        expect.objectContaining({ source: "duplicate-provider" }),
        expect.objectContaining({ source: "unsupported-provider" }),
        expect.objectContaining({ source: "family-mismatch-provider" }),
      ]),
    );
  });

  it("turns provider timeouts into failed diagnostic evidence", async () => {
    const slowProvider: OptionalSignalProvider = {
      name: "slow-provider",
      collect: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({
            source: "slow-provider",
            status: "present",
            category: "file_layout",
            freshness: "current",
            confidence: "high",
            evidence: ["slow evidence"],
          }), 50);
        }),
    };

    const result = await runOptionalSignalProviders(context, [slowProvider], {
      timeoutMs: 1,
    });

    expect(result.telemetry.test[0]).toMatchObject({
      source: "slow-provider",
      status: "failed",
      confidence: "low",
    });
    expect(result.telemetry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "slow-provider",
          message: expect.stringContaining("timed out"),
        }),
      ]),
    );
  });
});
