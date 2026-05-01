import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ClaudePluginMode = "advisory" | "balanced" | "strict";
export type ClaudePluginMemoryLocation = "project" | "user" | "external";
export type ClaudePluginEvaluator = "local" | "host" | "external";

export type ClaudePluginOptions = {
  coach_mode?: string;
  memory_location?: string;
  evaluator?: string;
  external_endpoint?: string;
  external_token?: string;
};

export type ClaudePluginIssue = {
  field: string;
  message: string;
};

export type ClaudePluginAssetReport = {
  manifest: Record<string, unknown>;
  mcpConfig: Record<string, unknown>;
  hooksConfig: Record<string, unknown>;
  settings: Record<string, unknown>;
  skillText: string;
  issues: ClaudePluginIssue[];
};

const validModes = new Set<ClaudePluginMode>(["advisory", "balanced", "strict"]);
const validMemoryLocations = new Set<ClaudePluginMemoryLocation>(["project", "user", "external"]);
const validEvaluators = new Set<ClaudePluginEvaluator>(["local", "host", "external"]);

export function validateClaudePluginOptions(
  options: ClaudePluginOptions,
): ClaudePluginIssue[] {
  const issues: ClaudePluginIssue[] = [];
  const mode = options.coach_mode ?? "advisory";
  const memoryLocation = options.memory_location ?? "project";
  const evaluator = options.evaluator ?? "local";

  if (!validModes.has(mode as ClaudePluginMode)) {
    issues.push({
      field: "coach_mode",
      message: "must be advisory, balanced, or strict",
    });
  }
  if (!validMemoryLocations.has(memoryLocation as ClaudePluginMemoryLocation)) {
    issues.push({
      field: "memory_location",
      message: "must be project, user, or external",
    });
  }
  if (!validEvaluators.has(evaluator as ClaudePluginEvaluator)) {
    issues.push({
      field: "evaluator",
      message: "must be local, host, or external",
    });
  }
  if (evaluator === "external" && !options.external_endpoint) {
    issues.push({
      field: "external_endpoint",
      message: "is required when evaluator is external",
    });
  }

  return issues;
}

export function inspectClaudePluginAssets(root: string): ClaudePluginAssetReport {
  const manifest = readJson(join(root, ".claude-plugin", "plugin.json"));
  const mcpConfig = readJson(join(root, ".mcp.json"));
  const hooksConfig = readJson(join(root, "hooks", "hooks.json"));
  const settings = readJson(join(root, "settings.json"));
  const skillPath = join(root, "skills", "architecture-coach", "SKILL.md");
  const skillText = readFileSync(skillPath, "utf8");
  const issues: ClaudePluginIssue[] = [];

  requireString(manifest, "name", issues);
  requireString(manifest, "description", issues);
  requireString(manifest, "version", issues);
  requirePath(root, ".mcp.json", issues);
  requirePath(root, "hooks/hooks.json", issues);
  requirePath(root, "settings.json", issues);
  requireExecutable(root, "bin/archcoach", issues);
  requireExecutable(root, "bin/archcoach-mcp", issues);

  if (!isRecord(manifest.userConfig)) {
    issues.push({ field: "userConfig", message: "is required" });
  } else {
    issues.push(...validateManifestUserConfig(manifest.userConfig));
  }
  if (!isRecord(mcpConfig.mcpServers) || !isRecord(mcpConfig.mcpServers["tech-coach"])) {
    issues.push({ field: "mcpServers.tech-coach", message: "is required" });
  }
  if (!isRecord(hooksConfig.hooks)) {
    issues.push({ field: "hooks.hooks", message: "must be an object" });
  }
  if (!skillText.includes("architecture.apply_interview_answers")) {
    issues.push({
      field: "skills/architecture-coach/SKILL.md",
      message: "must reference the interview answer application tool",
    });
  }
  if (!skillText.includes("Do not answer the questions yourself")) {
    issues.push({
      field: "skills/architecture-coach/SKILL.md",
      message: "must prohibit invented interview answers",
    });
  }

  return { manifest, mcpConfig, hooksConfig, settings, skillText, issues };
}

function validateManifestUserConfig(
  userConfig: Record<string, unknown>,
): ClaudePluginIssue[] {
  const issues: ClaudePluginIssue[] = [];
  for (const key of [
    "coach_mode",
    "memory_location",
    "evaluator",
    "external_endpoint",
    "external_token",
  ]) {
    const entry = userConfig[key];
    if (!isRecord(entry)) {
      issues.push({ field: `userConfig.${key}`, message: "is required" });
      continue;
    }
    requireString(entry, "type", issues, `userConfig.${key}`);
    requireString(entry, "title", issues, `userConfig.${key}`);
    requireString(entry, "description", issues, `userConfig.${key}`);
  }
  return issues;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  issues: ClaudePluginIssue[],
  prefix?: string,
): void {
  if (typeof record[field] !== "string" || record[field].trim().length === 0) {
    issues.push({
      field: prefix ? `${prefix}.${field}` : field,
      message: "must be a non-empty string",
    });
  }
}

function requirePath(
  root: string,
  path: string,
  issues: ClaudePluginIssue[],
): void {
  if (!existsSync(join(root, path))) {
    issues.push({ field: path, message: "is missing" });
  }
}

function requireExecutable(
  root: string,
  path: string,
  issues: ClaudePluginIssue[],
): void {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    issues.push({ field: path, message: "is missing" });
    return;
  }
  if ((statSync(absolute).mode & 0o111) === 0) {
    issues.push({ field: path, message: "must be executable" });
  }
}

function readJson(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
