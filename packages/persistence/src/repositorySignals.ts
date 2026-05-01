import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { TestSummary } from "../../kernel/src/protocol.js";
import { telemetryFromEvidence } from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { architectureShapeProvider } from "../../signals/src/architectureShape.js";
import { configBoundaryProvider } from "../../signals/src/config.js";
import { diagnosticsProvider } from "../../signals/src/diagnostics.js";
import { fileTreeProvider } from "../../signals/src/fileTree.js";
import { gitDiffProvider } from "../../signals/src/gitDiff.js";
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
};

const ignoredDirs = new Set([
  ".git",
  ".ceetrix",
  ".claude",
  ".agents",
  "node_modules",
  "dist",
  "build",
  ".build",
  "coverage",
  "test-results",
  "playwright-report",
  ".next",
  ".turbo",
  ".cache",
  "target",
]);

export function collectRepositoryTelemetry(
  input: RepositorySignalCollectionInput,
): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  optionalSignals: OptionalSignalResult[];
} {
  const repoRoot = resolve(input.repoRoot);
  const knownFiles = listKnownFiles(repoRoot, input.maxFiles ?? 1500);
  const changedFiles = listChangedFiles(repoRoot);
  const request = input.request
    ?? "Assess this brownfield repository and recommend the next architecture move.";
  const context: SignalContext = {
    cwd: repoRoot,
    knownFiles,
    changedFiles,
    userRequest: request,
    recentRequests: [request],
    testSummary: readTestSummary(repoRoot),
  };
  const optionalSignals = collectSynchronousProviders(context);
  const testSummary = readTestSummary(repoRoot);
  const event: CoachEventEnvelope = {
    host: "ceetrix-tech-lead",
    event: "brownfield-capture",
    cwd: repoRoot,
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
    fileTreeProvider,
    architectureShapeProvider,
    gitDiffProvider,
    configBoundaryProvider,
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

function normalizeProviderOutput(
  output: OptionalSignalResult | OptionalSignalResult[] | undefined | null,
): OptionalSignalResult[] {
  if (!output) {
    return [];
  }
  return Array.isArray(output) ? output : [output];
}

function listKnownFiles(repoRoot: string, maxFiles: number): string[] {
  const gitFiles = runGit(repoRoot, ["ls-files"]);
  if (gitFiles.length > 0) {
    return gitFiles.filter((file) => !isIgnoredPath(file)).slice(0, maxFiles);
  }
  return walkFiles(repoRoot, repoRoot, maxFiles);
}

function listChangedFiles(repoRoot: string): string[] {
  return Array.from(new Set([
    ...runGit(repoRoot, ["diff", "--name-only", "HEAD"]),
    ...runGit(repoRoot, ["ls-files", "--others", "--modified", "--exclude-standard"]),
  ])).filter((file) => !isIgnoredPath(file)).sort();
}

function readTestSummary(repoRoot: string): TestSummary {
  const packagePath = join(repoRoot, "package.json");
  if (!existsSync(packagePath)) {
    return { status: "unknown", summary: "No package.json test script detected." };
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

function walkFiles(root: string, current: string, maxFiles: number, files: string[] = []): string[] {
  if (files.length >= maxFiles) {
    return files;
  }
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (files.length >= maxFiles) {
      break;
    }
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, absolute, maxFiles, files);
    } else if (entry.isFile()) {
      files.push(relative(root, absolute));
    }
  }
  return files;
}

function isIgnoredPath(file: string): boolean {
  return file.split("/").some((part) => ignoredDirs.has(part));
}
