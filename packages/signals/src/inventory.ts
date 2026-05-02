import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ArchitectureEvidenceFact } from "../../kernel/src/claimTypes.js";
import type {
  OptionalSignalProvider,
  OptionalSignalResult,
  ProjectInventory,
  ProjectInventoryEntry,
  SignalContext,
} from "./index.js";

const ignoredPathRules: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "git metadata", pattern: /^\.git(\/|$)/ },
  { reason: "tech lead generated artifacts", pattern: /^\.ceetrix(\/|$)/ },
  { reason: "agent runtime artifacts", pattern: /^(\.claude|\.agents)(\/|$)/ },
  { reason: "dependency install", pattern: /(^|\/)node_modules\// },
  { reason: "build output", pattern: /(^|\/)(dist|build|\.build|\.next|\.turbo)(\/|$)/ },
  { reason: "coverage or test output", pattern: /(^|\/)(coverage|test-results|playwright-report)(\/|$)/ },
  { reason: "tool cache", pattern: /(^|\/)(\.cache|chrome_profile|Code Cache|CacheStorage|GPUCache|Service Worker)(\/|$)/ },
  { reason: "compiled target output", pattern: /(^|\/)target\// },
  { reason: "binary or lock noise", pattern: /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|sqlite|db)$/i },
];

export function buildProjectInventory(repoRoot: string, maxFiles = 1500): ProjectInventory {
  const root = resolve(repoRoot);
  const gitFiles = runGit(root, ["ls-files"]);
  const source: ProjectInventory["source"] = gitFiles.length > 0 ? "git" : "walk";
  const observed = gitFiles.length > 0 ? gitFiles : walkFiles(root, root, maxFiles * 2);
  const entries: ProjectInventoryEntry[] = [];
  const excluded: ProjectInventoryEntry[] = [];
  const included: string[] = [];

  for (const path of observed.sort()) {
    const reason = ignoredReason(path);
    if (reason) {
      const entry: ProjectInventoryEntry = { path, status: "excluded", reason, source };
      entries.push(entry);
      excluded.push(entry);
      continue;
    }
    if (included.length >= maxFiles) {
      const entry: ProjectInventoryEntry = {
        path,
        status: "excluded",
        reason: "inventory maxFiles limit",
        source,
      };
      entries.push(entry);
      excluded.push(entry);
      continue;
    }
    entries.push({ path, status: "included", source });
    included.push(path);
  }

  return {
    files: included,
    entries,
    excluded,
    totalObserved: observed.length,
    complete: included.length + excluded.filter((entry) => entry.reason !== "inventory maxFiles limit").length === observed.length,
    maxFiles,
    source,
    diagnostics: included.length >= maxFiles && observed.length > maxFiles
      ? [`inventory truncated at ${maxFiles} files`]
      : [],
  };
}

export function isIgnoredProjectPath(path: string): boolean {
  return ignoredReason(path) !== undefined;
}

export const inventoryProvider: OptionalSignalProvider = {
  name: "inventory",
  collect(context: SignalContext): OptionalSignalResult {
    const inventory = context.inventory ?? buildProjectInventory(context.cwd);
    const facts = factsForInventory(inventory);
    return {
      source: "inventory",
      status: inventory.files.length > 0 ? "present" : "absent",
      category: "file_layout",
      freshness: "current",
      confidence: inventory.complete ? "high" : "medium",
      evidence: [
        `inventory files included: ${inventory.files.length}`,
        `inventory files excluded: ${inventory.excluded.length}`,
        `inventory source: ${inventory.source}`,
        ...(inventory.diagnostics.length > 0 ? inventory.diagnostics : []),
      ],
      details: { inventory: summarizeInventory(inventory) },
      facts,
    };
  },
};

function factsForInventory(inventory: ProjectInventory): ArchitectureEvidenceFact[] {
  const important = inventory.files.filter((path) =>
    /(^|\/)(package\.json|wrangler\.toml(\.example)?|README\.md|docs\/|src\/|workers\/|apps\/|packages\/|crates\/|Package\.swift|Cargo\.toml|migrations\/)/i.test(path)
  ).slice(0, 80);
  const included = important.map((path): ArchitectureEvidenceFact => ({
    id: factId("inventory.file", path),
    concern: "application_shape",
    family: "package_boundary",
    kind: "inventory.file",
    label: "inventoried source file",
    summary: `Inventory includes ${path}`,
    source: "inventory",
    confidence: "high",
    freshness: "current",
    provenance: [{ path }],
  }));
  const excludedByReason = new Map<string, number>();
  for (const entry of inventory.excluded) {
    const reason = entry.reason ?? "ignored";
    excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
  }
  const excluded = Array.from(excludedByReason.entries()).map(([reason, count]): ArchitectureEvidenceFact => ({
    id: factId("inventory.excluded", reason),
    concern: "application_shape",
    family: "unknown",
    kind: "inventory.excluded",
    label: "excluded repository noise",
    summary: `Inventory excludes ${count} ${reason} item(s).`,
    source: "inventory",
    confidence: "high",
    freshness: "current",
    provenance: [{ excerpt: reason }],
    metadata: { reason, count },
  }));
  return [...included, ...excluded];
}

function summarizeInventory(inventory: ProjectInventory): Record<string, unknown> {
  const excludedByReason: Record<string, number> = {};
  for (const entry of inventory.excluded) {
    const reason = entry.reason ?? "ignored";
    excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  }
  return {
    files: inventory.files,
    totalObserved: inventory.totalObserved,
    includedCount: inventory.files.length,
    excludedCount: inventory.excluded.length,
    excludedByReason,
    complete: inventory.complete,
    maxFiles: inventory.maxFiles,
    source: inventory.source,
    diagnostics: inventory.diagnostics,
  };
}

function ignoredReason(path: string): string | undefined {
  return ignoredPathRules.find((rule) => rule.pattern.test(path))?.reason;
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
    const absolute = join(current, entry.name);
    const path = relative(root, absolute);
    if (ignoredReason(path)) {
      files.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      walkFiles(root, absolute, maxFiles, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function factId(kind: string, path: string): string {
  return `${kind}:${path}`.replace(/[^a-zA-Z0-9:_./-]+/g, "-");
}
