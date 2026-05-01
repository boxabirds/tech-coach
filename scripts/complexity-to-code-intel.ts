#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { codeIntelligenceSchemaVersion, type CodeIntelligenceReport } from "../packages/signals/src/codeIntelligenceTypes.js";

type ComplexityFunction = {
  file: string;
  name: string;
  line?: number;
  end_line?: number;
  cyclomatic_complexity?: number;
};

type ComplexityFile = {
  path: string;
  language: string;
  parse_success: boolean;
  functions?: ComplexityFunction[];
};

type ComplexityReport = {
  repository: string;
  summary: {
    total_files: number;
    total_functions: number;
    languages: Record<string, number>;
    total_cyclomatic_complexity: number;
    parse_success_rate: number;
  };
  files?: ComplexityFile[];
};

type Args = {
  manifestPath: string;
  repo: string;
};

const args = parseArgs(process.argv.slice(2));
const repo = resolve(args.repo);
if (!existsSync(repo)) {
  throw new Error(`Repository path does not exist: ${repo}`);
}
if (!existsSync(args.manifestPath)) {
  throw new Error(`Complexity analyzer Cargo.toml does not exist: ${args.manifestPath}`);
}

const analyzer = spawnSync("cargo", [
  "run",
  "--quiet",
  "--manifest-path",
  args.manifestPath,
  "--",
  "--path",
  repo,
  "--include-files",
], {
  cwd: repo,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  maxBuffer: 1024 * 1024 * 64,
});

if (analyzer.error) {
  throw analyzer.error;
}
if (analyzer.status !== 0) {
  throw new Error(`complexity analyzer exited with ${analyzer.status}: ${analyzer.stderr.trim()}`);
}

const report = JSON.parse(analyzer.stdout) as ComplexityReport;
const files = report.files ?? [];
const output: CodeIntelligenceReport = {
  schemaVersion: codeIntelligenceSchemaVersion,
  producer: {
    name: "complexity-analyzer",
    engine: "rust-tree-sitter",
  },
  repoRoot: repo,
  generatedAt: new Date().toISOString(),
  languages: Object.entries(report.summary.languages).map(([languageId, count]) => {
    const languageFiles = files.filter((file) => file.language === languageId);
    return {
      id: languageId,
      files: count,
      parsed: languageFiles.filter((file) => file.parse_success).length,
      failed: languageFiles.filter((file) => !file.parse_success).length,
      parser: `tree-sitter-${languageId}`,
      variants: variantsFor(languageFiles),
    };
  }),
  files: files.map((file) => ({
    path: file.path,
    languageId: file.language,
    parsed: file.parse_success,
  })),
  symbols: files.flatMap((file) => (file.functions ?? []).map((fn) => ({
    name: fn.name,
    kind: "function",
    languageId: file.language,
    location: {
      file: fn.file || file.path,
      startLine: fn.line,
      endLine: fn.end_line,
    },
    complexity: fn.cyclomatic_complexity,
  }))),
  dependencies: [],
  complexity: {
    unitCount: report.summary.total_functions,
    totalCyclomaticComplexity: report.summary.total_cyclomatic_complexity,
    maxUnitCyclomaticComplexity: maxComplexity(files),
  },
  diagnostics: files.flatMap((file) => (file.functions ?? [])
    .filter((fn) => (fn.cyclomatic_complexity ?? 0) >= 15)
    .map((fn) => ({
      severity: "warning" as const,
      message: `high complexity function ${fn.name} has cyclomatic complexity ${fn.cyclomatic_complexity}`,
      file: fn.file || file.path,
      languageId: file.language,
    }))),
};

process.stdout.write(`${JSON.stringify(output)}\n`);

function maxComplexity(files: ComplexityFile[]): number {
  return Math.max(0, ...files.flatMap((file) =>
    (file.functions ?? []).map((fn) => fn.cyclomatic_complexity ?? 0)
  ));
}

function variantsFor(files: ComplexityFile[]): string[] | undefined {
  const variants = Array.from(new Set(files
    .map((file) => extname(file.path).slice(1))
    .filter(Boolean))).sort();
  return variants.length > 0 ? variants : undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    manifestPath: "/Users/julian/expts/softwarepilots/packages/pilot-log/complexity-analyzer/Cargo.toml",
    repo: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--manifest":
        args.manifestPath = resolve(requiredValue(argv, ++index, arg));
        break;
      case "--repo":
        args.repo = requiredValue(argv, ++index, arg);
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        args.repo = arg;
        break;
    }
  }
  return args;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printUsage(): void {
  process.stdout.write([
    "Usage: complexity-to-code-intel.ts [repo] [options]",
    "",
    "Runs the Rust tree-sitter complexity analyzer and adapts it to tech-coach.code-intelligence.v1.",
    "",
    "Options:",
    "  --repo <path>       Target repository. Defaults to current directory.",
    "  --manifest <path>   Cargo.toml for the complexity analyzer.",
    "  --help              Show this help.",
    "",
  ].join("\n"));
}
