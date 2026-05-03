import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { TestSummary } from "../../kernel/src/protocol.js";
import { telemetryFromEvidence } from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { architectureShapeProvider } from "../../signals/src/architectureShape.js";
import { claimCandidateProvider } from "../../signals/src/claimCandidates.js";
import {
  codeIntelligenceReportToEvidence,
  parseCodeIntelligenceReport,
} from "../../signals/src/codeIntelligence.js";
import { configBoundaryProvider } from "../../signals/src/config.js";
import { documentationProvider } from "../../signals/src/documentation.js";
import { diagnosticsProvider } from "../../signals/src/diagnostics.js";
import { fileTreeProvider } from "../../signals/src/fileTree.js";
import { gitDiffProvider } from "../../signals/src/gitDiff.js";
import { buildProjectInventory, inventoryProvider, isIgnoredProjectPath } from "../../signals/src/inventory.js";
import type {
  OptionalSignalResult,
  SignalContext,
} from "../../signals/src/index.js";

export type RepositorySignalCollectionInput = {
  repoRoot: string;
  request?: string;
  capturedAt: string;
  correlationId: string;
  maxFiles?: number;
  codeIntelligenceCommand?: string;
  codeIntelligenceArgs?: string[];
};

export function collectRepositoryTelemetry(
  input: RepositorySignalCollectionInput,
): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  optionalSignals: OptionalSignalResult[];
} {
  const repoRoot = resolve(input.repoRoot);
  const inventory = buildProjectInventory(repoRoot, input.maxFiles ?? 1500);
  const knownFiles = inventory.files;
  const changedFiles = listChangedFiles(repoRoot);
  const request = input.request
    ?? "Capture a passive repository baseline.";
  const testSummary = readTestSummary(repoRoot);
  const context: SignalContext = {
    cwd: repoRoot,
    knownFiles,
    inventory,
    changedFiles,
    userRequest: request,
    recentRequests: [request],
    testSummary,
  };
  const optionalSignals = [
    ...collectSynchronousProviders(context),
    ...collectRequiredCodeIntelligence(context, input),
  ];
  const event: CoachEventEnvelope = {
    host: "ceetrix-tech-lead",
    event: "brownfield-capture",
    cwd: repoRoot,
    ...(!input.request ? { interactionContext: "passive_baseline" as const } : {}),
    userRequest: request,
    recentRequests: [request],
    changedFiles,
    repoSignals: {
      status: knownFiles.length > 0 ? "present" : "absent",
      evidence: [
        `known files: ${knownFiles.length}`,
        `changed files: ${changedFiles.length}`,
      ],
    },
    memoryRefs: [],
    priorDecisions: [],
    optionalSignals,
  };
  return {
    event,
    telemetry: telemetryFromEvidence({
      event,
      evidence: optionalSignals,
      testSummary,
      capturedAt: input.capturedAt,
      correlationId: input.correlationId,
    }),
    optionalSignals,
  };
}

function collectSynchronousProviders(context: SignalContext): OptionalSignalResult[] {
  return [
    inventoryProvider,
    fileTreeProvider,
    architectureShapeProvider,
    claimCandidateProvider,
    gitDiffProvider,
    configBoundaryProvider,
    documentationProvider,
    diagnosticsProvider,
  ].flatMap((provider) => {
    try {
      const output = provider.collect(context);
      if (output && typeof (output as Promise<unknown>).then === "function") {
        return [{
          source: provider.name ?? "provider",
          status: "failed",
          category: "diagnostic",
          freshness: "unknown",
          confidence: "low",
          evidence: [],
          error: "provider returned async output in synchronous capture path",
        } satisfies OptionalSignalResult];
      }
      return normalizeProviderOutput(output as OptionalSignalResult | OptionalSignalResult[] | undefined | null);
    } catch (error) {
      return [{
        source: provider.name ?? "provider",
        status: "failed",
        category: "diagnostic",
        freshness: "unknown",
        confidence: "low",
        evidence: [],
        error: error instanceof Error ? error.message : String(error),
      } satisfies OptionalSignalResult];
    }
  });
}

function collectRequiredCodeIntelligence(
  context: SignalContext,
  input: RepositorySignalCollectionInput,
): OptionalSignalResult[] {
  const command = input.codeIntelligenceCommand
    ?? process.env.CEETRIX_TECH_LEAD_CODE_INTEL_COMMAND
    ?? process.env.TECH_COACH_CODE_INTEL_COMMAND
    ?? defaultCodeIntelligenceCommand();
  const args = input.codeIntelligenceArgs
    ?? envArgs(process.env.CEETRIX_TECH_LEAD_CODE_INTEL_ARGS)
    ?? envArgs(process.env.TECH_COACH_CODE_INTEL_ARGS)
    ?? [];

  if (!existsSync(command)) {
    throw new Error(`Required code intelligence producer is missing: ${command}`);
  }

  const result = execFileSync(command, args, {
    cwd: context.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 64,
  });
  return codeIntelligenceReportToEvidence(
    parseCodeIntelligenceReport(result),
    { changedFiles: context.changedFiles },
  );
}

function defaultCodeIntelligenceCommand(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/complexity-to-code-intel.ts");
}

function envArgs(value: string | undefined): string[] | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to simple whitespace splitting for local shell use.
  }
  return value.split(/\s+/).filter(Boolean);
}

function normalizeProviderOutput(
  output: OptionalSignalResult | OptionalSignalResult[] | undefined | null,
): OptionalSignalResult[] {
  if (!output) {
    return [];
  }
  return Array.isArray(output) ? output : [output];
}

function listChangedFiles(repoRoot: string): string[] {
  return Array.from(new Set([
    ...runGit(repoRoot, ["diff", "--name-only", "HEAD"]),
    ...runGit(repoRoot, ["ls-files", "--others", "--modified", "--exclude-standard"]),
  ])).filter((file) => !isIgnoredProjectPath(file)).sort();
}

function readTestSummary(repoRoot: string): TestSummary | undefined {
  const packagePath = join(repoRoot, "package.json");
  if (!existsSync(packagePath)) {
    return undefined;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (packageJson.scripts?.test) {
      return {
        status: "not_run",
        summary: `package.json defines test script: ${packageJson.scripts.test}`,
      };
    }
  } catch {
    return { status: "unknown", summary: "package.json could not be parsed." };
  }
  return { status: "unknown", summary: "package.json has no test script." };
}

function runGit(repoRoot: string, args: string[]): string[] {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 8,
    }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
