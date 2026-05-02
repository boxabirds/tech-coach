import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchitectureConcern, BaselineConfidence } from "../../kernel/src/baselineTypes.js";
import type { ArchitectureEvidenceFact, ArchitectureFactKind, ClaimEvidenceFamily } from "../../kernel/src/claimTypes.js";
import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";
import {
  codeIntelligenceSchemaVersion,
  type CodeDependency,
  type CodeFileSummary,
  type CodeIntelligenceDiagnostic,
  type CodeIntelligenceReport,
  type CodeLanguageSummary,
  type CodeSymbol,
} from "./codeIntelligenceTypes.js";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CodeIntelligenceCommandOptions = {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runCommand?: (
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<CommandResult>;
};

export function codeIntelligenceProvider(
  options: CodeIntelligenceCommandOptions = {},
): OptionalSignalProvider {
  return {
    name: "code-intelligence",
    async collect(context: SignalContext): Promise<OptionalSignalResult[]> {
      return collectCodeIntelligenceEvidence(context, options);
    },
  };
}

export const staticCodeIntelligenceProvider: OptionalSignalProvider = {
  name: "static-code-intelligence",
  collect(context: SignalContext): OptionalSignalResult[] {
    const files = selectSourceFiles(context.knownFiles ?? context.changedFiles).slice(0, 700);
    if (files.length === 0) {
      return [{
        source: "static-code-intelligence",
        status: "absent",
        category: "diagnostic",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no source files available for static code intelligence fallback",
      }];
    }

    const facts = files.flatMap((path) => factsForSourceFile(context.cwd, path));
    const relationships = facts
      .filter((fact) => fact.kind === "code.import" || fact.kind === "code.symbol")
      .slice(0, 30);
    const architectureFacts = facts.filter((fact) => fact.kind !== "code.import" && fact.kind !== "code.symbol");
    const output: OptionalSignalResult[] = [{
      source: "static-code-intelligence",
      status: "present",
      category: "file_layout",
      freshness: "current",
      confidence: facts.length >= 8 ? "medium" : "low",
      evidence: [
        `static source files scanned: ${files.length}`,
        `static code facts extracted: ${facts.length}`,
      ],
      details: { sourceFilesScanned: files.length },
      facts,
    }];

    if (relationships.length > 0) {
      output.push({
        source: "static-code-intelligence",
        status: "present",
        category: "import_relationship",
        freshness: "current",
        confidence: "medium",
        evidence: relationships.map(formatFactEvidence),
        facts: relationships,
      });
    }
    if (architectureFacts.length > 0) {
      output.push({
        source: "static-code-intelligence",
        status: "present",
        category: "architecture_claim",
        freshness: "current",
        confidence: architectureFacts.length >= 6 ? "high" : "medium",
        evidence: architectureFacts.map(formatFactEvidence).slice(0, 60),
        facts: architectureFacts,
      });
    }
    return output;
  },
};

export async function collectCodeIntelligenceEvidence(
  context: SignalContext,
  options: CodeIntelligenceCommandOptions = {},
): Promise<OptionalSignalResult[]> {
  if (!options.command) {
    return [{
      source: "code-intelligence",
      status: "absent",
      category: "diagnostic",
      freshness: "unknown",
      confidence: "low",
      evidence: [],
      error: "no code intelligence producer configured",
    }];
  }

  try {
    const result = await (options.runCommand ?? runCommand)(
      options.command,
      options.args ?? [],
      { cwd: context.cwd, timeoutMs: options.timeoutMs ?? 10_000 },
    );
    if (result.exitCode !== 0) {
      return [{
        source: "code-intelligence",
        status: "failed",
        category: "diagnostic",
        freshness: "current",
        confidence: "low",
        evidence: result.stderr ? [result.stderr] : [],
        error: `producer exited with code ${result.exitCode}`,
      }];
    }

    const report = parseCodeIntelligenceReport(result.stdout);
    return codeIntelligenceReportToEvidence(report, context);
  } catch (error) {
    return [{
      source: "code-intelligence",
      status: "failed",
      category: "diagnostic",
      freshness: "current",
      confidence: "low",
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    }];
  }
}

export function parseCodeIntelligenceReport(raw: string): CodeIntelligenceReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`malformed code intelligence JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("code intelligence report must be an object");
  }
  if (parsed.schemaVersion !== codeIntelligenceSchemaVersion) {
    throw new Error(`unsupported code intelligence schemaVersion ${String(parsed.schemaVersion)}`);
  }
  if (!isRecord(parsed.producer) || typeof parsed.producer.name !== "string") {
    throw new Error("code intelligence report producer.name is required");
  }
  if (typeof parsed.repoRoot !== "string") {
    throw new Error("code intelligence report repoRoot is required");
  }
  assertArray(parsed.languages, "languages");
  assertArray(parsed.files, "files");
  assertArray(parsed.symbols, "symbols");
  assertArray(parsed.dependencies, "dependencies");

  const report = parsed as CodeIntelligenceReport;
  validateLanguages(report.languages);
  validateFiles(report.files);
  validateSymbols(report.symbols);
  validateDependencies(report.dependencies);
  if (report.diagnostics) {
    validateDiagnostics(report.diagnostics);
  }
  return report;
}

export function codeIntelligenceReportToEvidence(
  report: CodeIntelligenceReport,
  context: Pick<SignalContext, "changedFiles"> = { changedFiles: [] },
): OptionalSignalResult[] {
  const source = `code-intelligence:${report.producer.name}`;
  const parseCoverage = calculateParseCoverage(report.files);
  const evidence: OptionalSignalResult[] = [{
    source,
    status: "present",
    category: "file_layout",
    freshness: "current",
    confidence: confidenceForCoverage(parseCoverage),
    evidence: [
      `producer: ${report.producer.name}${report.producer.engine ? ` (${report.producer.engine})` : ""}`,
      `repo root: ${report.repoRoot}`,
      `parse coverage: ${parseCoverage.parsed}/${parseCoverage.total}`,
      `languages: ${report.languages.map(formatLanguage).join("; ") || "(none)"}`,
      report.complexity
        ? `complexity: units=${report.complexity.unitCount ?? "unknown"} total_cc=${report.complexity.totalCyclomaticComplexity ?? "unknown"} max_cc=${report.complexity.maxUnitCyclomaticComplexity ?? "unknown"}`
        : undefined,
    ].filter((item): item is string => typeof item === "string"),
  }];

  const relevantDependencies = selectRelevantDependencies(report.dependencies, context.changedFiles);
  if (relevantDependencies.length > 0) {
    const facts = relevantDependencies.slice(0, 60).map((dependency) =>
      makeCodeFact({
        id: `code.import.${dependency.source}.${dependency.target}`,
        concern: "package_boundary",
        family: "package_boundary",
        kind: "code.import",
        label: "code import relationship",
        summary: `${dependency.source} imports or references ${dependency.target}.`,
        path: dependency.source,
        confidence: "medium",
        relationships: [{ type: "imports", target: dependency.target }],
      })
    );
    evidence.push({
      source,
      status: "present",
      category: "import_relationship",
      freshness: "current",
      confidence: "medium",
      evidence: relevantDependencies.slice(0, 20).map(formatDependency),
      facts,
    });
  }

  const relevantSymbols = selectRelevantSymbols(report.symbols, context.changedFiles);
  if (relevantSymbols.length > 0) {
    const facts = relevantSymbols.slice(0, 60).map((symbol) =>
      makeCodeFact({
        id: `code.symbol.${symbol.location.file}.${symbol.name}`,
        concern: concernForSymbol(symbol),
        family: familyForSymbol(symbol),
        kind: "code.symbol",
        label: `${symbol.kind} ${symbol.name}`,
        summary: `${symbol.kind} ${symbol.name} is declared in ${symbol.location.file}.`,
        path: symbol.location.file,
        line: symbol.location.startLine,
        symbol: symbol.name,
        confidence: "medium",
      })
    );
    evidence.push({
      source,
      status: "present",
      category: "symbol_reference",
      freshness: "current",
      confidence: "medium",
      evidence: relevantSymbols.slice(0, 20).map(formatSymbol),
      facts,
    });
  }

  const diagnostics = [
    ...diagnosticsFromReport(report),
    ...diagnosticsForMissingVariants(report.files, report.languages),
  ];
  if (diagnostics.length > 0) {
    evidence.push({
      source,
      status: "present",
      category: "diagnostic",
      freshness: "current",
      confidence: "medium",
      evidence: diagnostics.map(formatDiagnostic),
    });
  }

  return evidence;
}

function selectSourceFiles(files: string[]): string[] {
  return files.filter((file) =>
    /\.(tsx?|jsx?|mjs|cjs|rs|swift|go|py|rb|php|java|kt|cs)$/i.test(file)
    && !/(^|\/)(node_modules|dist|build|coverage|test-results|playwright-report|target)\//.test(file)
    && !/\.d\.ts$/i.test(file)
  ).sort(compareSourcePath);
}

function factsForSourceFile(cwd: string, path: string): ArchitectureEvidenceFact[] {
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) {
    return [];
  }
  const content = readFileSync(absolute).subarray(0, 96_000).toString("utf8");
  const facts: ArchitectureEvidenceFact[] = [];
  for (const dependency of importTargets(content).slice(0, 12)) {
    facts.push(makeCodeFact({
      id: `code.import.${path}.${dependency}`,
      concern: "package_boundary",
      family: "package_boundary",
      kind: "code.import",
      label: "code import relationship",
      summary: `${path} imports ${dependency}.`,
      path,
      confidence: "medium",
      relationships: [{ type: "imports", target: dependency }],
    }));
  }
  for (const symbol of exportedSymbols(content).slice(0, 8)) {
    facts.push(makeCodeFact({
      id: `code.symbol.${path}.${symbol.name}`,
      concern: concernForSource(path, content),
      family: familyForSource(path, content),
      kind: "code.symbol",
      label: `${symbol.kind} ${symbol.name}`,
      summary: `${path} exports ${symbol.kind} ${symbol.name}.`,
      path,
      line: symbol.line,
      symbol: symbol.name,
      confidence: "medium",
      relationships: [{ type: "exports", target: symbol.name }],
    }));
  }
  if (/github/i.test(content) && /(oauth|accessToken|client_id|clientSecret|authorize)/i.test(content)) {
    facts.push(makeCodeFact({
      id: `auth.github-oauth.code.${path}`,
      concern: "authentication",
      family: "external_provider",
      kind: "auth.github_oauth",
      label: "GitHub OAuth code path",
      summary: `${path} contains GitHub OAuth implementation evidence.`,
      path,
      excerpt: excerptFor(content, /github|oauth|accessToken|authorize/i),
      confidence: "high",
    }));
  }
  if (/(session|cookie)/i.test(content) && /(kv|storage|set|get|sign|verify|httpOnly)/i.test(content)) {
    facts.push(makeCodeFact({
      id: `auth.session.code.${path}`,
      concern: "authentication",
      family: "session",
      kind: "auth.session",
      label: "server-side session code path",
      summary: `${path} contains session state implementation evidence.`,
      path,
      excerpt: excerptFor(content, /session|cookie|httpOnly|SESSION_KV/i),
      confidence: "high",
    }));
  }
  if (/(api[-_ ]?key|bearer|token)/i.test(content) && /(verify|hash|credential|authorization)/i.test(content)) {
    facts.push(makeCodeFact({
      id: `auth.credential.code.${path}`,
      concern: "authentication",
      family: "credential",
      kind: "auth.credential",
      label: "programmatic credential code path",
      summary: `${path} contains API key, token, or credential implementation evidence.`,
      path,
      excerpt: excerptFor(content, /api[-_ ]?key|bearer|token|credential/i),
      confidence: "medium",
    }));
  }
  if (/(membership|role|permission|rbac|userProjects|project_id)/i.test(content) && /(allow|deny|authorize|require|select|insert|update|delete)/i.test(content)) {
    facts.push(makeCodeFact({
      id: `authz.membership-role.code.${path}`,
      concern: "authorization",
      family: "authorization",
      kind: "authz.membership_role",
      label: "role or membership code path",
      summary: `${path} contains role, membership, or permission boundary evidence.`,
      path,
      excerpt: excerptFor(content, /membership|role|permission|rbac|userProjects/i),
      confidence: "high",
    }));
  }
  if (/(env\.DB|prepare\(|migrations?|d1|database)/i.test(content)) {
    facts.push(makeCodeFact({
      id: `storage.d1.code.${path}`,
      concern: "data_storage",
      family: /migrations?|schema/i.test(content) ? "schema" : "binding",
      kind: /migrations?|schema/i.test(content) ? "storage.schema" : "binding.d1",
      label: "D1 or database code path",
      summary: `${path} contains persistent database usage evidence.`,
      path,
      excerpt: excerptFor(content, /env\.DB|prepare\(|d1|database|migration/i),
      confidence: "medium",
    }));
  }
  if (/(describe|it|test)\s*\(|expect\(|XCTest|#[\[]test/i.test(content) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) || /(^|\/)tests?\//i.test(path)) {
    facts.push(makeCodeFact({
      id: `test.surface.code.${path}`,
      concern: "testing",
      family: "test_surface",
      kind: "test.surface",
      label: "code test surface",
      summary: `${path} contains test implementation evidence.`,
      path,
      excerpt: excerptFor(content, /(describe|it|test)\s*\(|expect\(|XCTest|#\[test\]/i),
      confidence: "medium",
    }));
  }
  if (/fetch\s*\(|addEventListener\s*\(\s*["']fetch|export\s+default\s*{[^}]*fetch/i.test(content)) {
    facts.push(makeCodeFact({
      id: `deployment.runtime.worker-code.${path}`,
      concern: "deployment",
      family: "deployment_config",
      kind: "deployment.runtime",
      label: "Worker-style request handler",
      summary: `${path} contains Worker-style request handling evidence.`,
      path,
      excerpt: excerptFor(content, /fetch\s*\(|addEventListener\s*\(\s*["']fetch|export\s+default/i),
      confidence: "medium",
    }));
  }
  return facts;
}

function makeCodeFact(input: {
  id: string;
  concern: ArchitectureConcern;
  family: ClaimEvidenceFamily;
  kind: ArchitectureFactKind;
  label: string;
  summary: string;
  path: string;
  line?: number;
  symbol?: string;
  excerpt?: string;
  confidence: BaselineConfidence;
  relationships?: ArchitectureEvidenceFact["relationships"];
}): ArchitectureEvidenceFact {
  return {
    id: stableId(input.id),
    concern: input.concern,
    family: input.family,
    kind: input.kind,
    label: input.label,
    summary: input.summary,
    source: "static-code-intelligence",
    confidence: input.confidence,
    freshness: "current",
    provenance: [{
      path: input.path,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.excerpt ? { excerpt: input.excerpt } : {}),
    }],
    ...(input.relationships ? { relationships: input.relationships } : {}),
  };
}

function importTargets(content: string): string[] {
  return Array.from(new Set([
    ...Array.from(content.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)).map((match) => match[1]),
    ...Array.from(content.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)).map((match) => match[1]),
  ])).filter(Boolean);
}

function exportedSymbols(content: string): Array<{ kind: string; name: string; line: number }> {
  const lines = content.split(/\r?\n/);
  const symbols: Array<{ kind: string; name: string; line: number }> = [];
  lines.forEach((line, index) => {
    const match = /\bexport\s+(?:async\s+)?(function|class|const|let|var|interface|type)\s+([A-Za-z0-9_$]+)/.exec(line)
      ?? /\b(public\s+)?(struct|class|func|actor)\s+([A-Za-z0-9_]+)/.exec(line);
    if (match) {
      symbols.push({
        kind: match[2] && match[2] !== undefined && !/function|class|const|let|var|interface|type/.test(match[2]) ? match[2] : match[1],
        name: match[3] ?? match[2],
        line: index + 1,
      });
    }
  });
  return symbols;
}

function concernForSource(path: string, content: string): ArchitectureConcern {
  if (/auth|oauth|session|token|credential/i.test(path + content.slice(0, 5000))) return "authentication";
  if (/membership|role|permission|rbac/i.test(path + content.slice(0, 5000))) return "authorization";
  if (/db|database|migration|schema|d1/i.test(path + content.slice(0, 5000))) return "data_storage";
  if (/deploy|worker|wrangler|fetch/i.test(path + content.slice(0, 5000))) return "deployment";
  if (/test|spec|e2e/i.test(path)) return "testing";
  return "package_boundary";
}

function familyForSource(path: string, content: string): ClaimEvidenceFamily {
  const text = path + content.slice(0, 5000);
  if (/oauth|github/i.test(text)) return "external_provider";
  if (/session|cookie/i.test(text)) return "session";
  if (/token|api[-_ ]?key|credential/i.test(text)) return "credential";
  if (/membership|role|permission|rbac/i.test(text)) return "authorization";
  if (/schema|migration/i.test(text)) return "schema";
  if (/d1|db|kv|binding/i.test(text)) return "binding";
  if (/worker|fetch|deploy/i.test(text)) return "deployment_config";
  if (/test|spec|e2e/i.test(path)) return "test_surface";
  return "package_boundary";
}

function concernForSymbol(symbol: CodeSymbol): ArchitectureConcern {
  return concernForSource(symbol.location.file, symbol.name);
}

function familyForSymbol(symbol: CodeSymbol): ClaimEvidenceFamily {
  return familyForSource(symbol.location.file, symbol.name);
}

function compareSourcePath(left: string, right: string): number {
  return sourceRank(left) - sourceRank(right) || left.localeCompare(right);
}

function sourceRank(path: string): number {
  let rank = 0;
  if (/\/src\//.test(path)) rank -= 20;
  if (/auth|session|membership|permission|worker|handler|route|migrations?/.test(path)) rank -= 25;
  if (/\.test\.|\.spec\.|\/tests?\//.test(path)) rank += 12;
  return rank;
}

function excerptFor(content: string, pattern: RegExp): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => pattern.test(candidate));
  return line?.trim().slice(0, 220);
}

function formatFactEvidence(fact: ArchitectureEvidenceFact): string {
  const citations = fact.provenance.map((item) => item.path ?? item.excerpt).filter(Boolean).join(", ");
  return `${fact.concern}.${fact.family}: ${fact.label}: ${citations || fact.summary}`;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`code intelligence producer timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

function calculateParseCoverage(files: CodeFileSummary[]): { parsed: number; total: number } {
  return {
    parsed: files.filter((file) => file.parsed).length,
    total: files.length,
  };
}

function confidenceForCoverage(coverage: { parsed: number; total: number }): "low" | "medium" | "high" {
  if (coverage.total === 0) {
    return "low";
  }
  const ratio = coverage.parsed / coverage.total;
  if (ratio >= 0.9) {
    return "high";
  }
  if (ratio >= 0.5) {
    return "medium";
  }
  return "low";
}

function selectRelevantDependencies(
  dependencies: CodeDependency[],
  changedFiles: string[],
): CodeDependency[] {
  if (changedFiles.length === 0) {
    return dependencies;
  }
  const changed = new Set(changedFiles);
  return dependencies.filter((dependency) => changed.has(dependency.source));
}

function selectRelevantSymbols(symbols: CodeSymbol[], changedFiles: string[]): CodeSymbol[] {
  if (changedFiles.length === 0) {
    return symbols;
  }
  const changed = new Set(changedFiles);
  return symbols.filter((symbol) => changed.has(symbol.location.file));
}

function diagnosticsFromReport(report: CodeIntelligenceReport): CodeIntelligenceDiagnostic[] {
  const fileDiagnostics = report.files
    .filter((file) => file.error || file.skipped || !file.parsed)
    .map((file): CodeIntelligenceDiagnostic => ({
      severity: file.error ? "warning" : "info",
      message: file.error ?? (file.skipped ? "file skipped by producer" : "file not parsed"),
      file: file.path,
      languageId: file.languageId,
    }));
  return [...(report.diagnostics ?? []), ...fileDiagnostics];
}

function diagnosticsForMissingVariants(
  files: CodeFileSummary[],
  languages: CodeLanguageSummary[],
): CodeIntelligenceDiagnostic[] {
  const variants = new Set(languages.flatMap((language) => language.variants ?? []));
  const diagnostics: CodeIntelligenceDiagnostic[] = [];
  if (files.some((file) => file.path.endsWith(".tsx")) && !variants.has("tsx")) {
    diagnostics.push({
      severity: "warning",
      message: "TSX files were reported but no TSX parser variant was declared",
      languageId: "tsx",
    });
  }
  return diagnostics;
}

function formatLanguage(language: CodeLanguageSummary): string {
  return [
    language.id,
    `files=${language.files}`,
    `parsed=${language.parsed}`,
    language.skipped !== undefined ? `skipped=${language.skipped}` : undefined,
    language.failed !== undefined ? `failed=${language.failed}` : undefined,
    language.variants?.length ? `variants=${language.variants.join("|")}` : undefined,
  ].filter((item): item is string => typeof item === "string").join(" ");
}

function formatDependency(dependency: CodeDependency): string {
  return `${dependency.kind}: ${dependency.source} -> ${dependency.target}`;
}

function formatSymbol(symbol: CodeSymbol): string {
  return `${symbol.kind}: ${symbol.name} @ ${symbol.location.file}:${symbol.location.startLine ?? "?"}`;
}

function formatDiagnostic(diagnostic: CodeIntelligenceDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.file ? `${diagnostic.file}:` : undefined,
    diagnostic.message,
  ].filter((item): item is string => typeof item === "string").join(" ");
}

function validateLanguages(languages: CodeLanguageSummary[]): void {
  languages.forEach((language, index) => {
    if (!isRecord(language) || typeof language.id !== "string") {
      throw new Error(`languages[${index}].id is required`);
    }
    if (typeof language.files !== "number" || typeof language.parsed !== "number") {
      throw new Error(`languages[${index}] must include files and parsed counts`);
    }
  });
}

function validateFiles(files: CodeFileSummary[]): void {
  files.forEach((file, index) => {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.languageId !== "string") {
      throw new Error(`files[${index}] path and languageId are required`);
    }
    if (typeof file.parsed !== "boolean") {
      throw new Error(`files[${index}].parsed must be boolean`);
    }
  });
}

function validateSymbols(symbols: CodeSymbol[]): void {
  symbols.forEach((symbol, index) => {
    if (!isRecord(symbol) || typeof symbol.name !== "string" || typeof symbol.kind !== "string") {
      throw new Error(`symbols[${index}] name and kind are required`);
    }
    if (!isRecord(symbol.location) || typeof symbol.location.file !== "string") {
      throw new Error(`symbols[${index}].location.file is required`);
    }
  });
}

function validateDependencies(dependencies: CodeDependency[]): void {
  const validKinds = new Set(["import", "call", "inheritance", "reference"]);
  dependencies.forEach((dependency, index) => {
    if (!isRecord(dependency) || typeof dependency.source !== "string" || typeof dependency.target !== "string") {
      throw new Error(`dependencies[${index}] source and target are required`);
    }
    if (!validKinds.has(String(dependency.kind))) {
      throw new Error(`dependencies[${index}].kind is unsupported`);
    }
  });
}

function validateDiagnostics(diagnostics: CodeIntelligenceDiagnostic[]): void {
  const severities = new Set(["info", "warning", "error"]);
  diagnostics.forEach((diagnostic, index) => {
    if (!isRecord(diagnostic) || !severities.has(String(diagnostic.severity)) || typeof diagnostic.message !== "string") {
      throw new Error(`diagnostics[${index}] severity and message are required`);
    }
  });
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_./-]+/g, "-").replace(/-+/g, "-");
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`code intelligence report ${field} must be an array`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
