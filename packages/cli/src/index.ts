#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessArchitecture,
  AssessmentValidationError,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import {
  readDecisionMemory,
  type DecisionRecord,
  type MemoryDiagnostic,
} from "../../kernel/src/memory.js";
import { ProtocolValidationError } from "../../kernel/src/protocol.js";
import { TelemetryValidationError } from "../../kernel/src/telemetryTypes.js";

export type CliOutputFormat = "json" | "text";

export type CliOptions = {
  inputPath?: string;
  output: CliOutputFormat;
  memoryPath?: string;
  readOnly: boolean;
};

export type CliRuntime = {
  argv: string[];
  cwd: string;
  readStdin: () => string;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type CliRunResult = {
  exitCode: number;
  output?: string;
  error?: string;
};

type AssessmentOutput = {
  result: AssessmentResult;
  memoryDiagnostics: MemoryDiagnostic[];
};

const defaultRuntimeArtifact = "dist/cli.js";

export function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const command = args.shift();
  if (command && command !== "assess") {
    throw new CliUsageError(`Unsupported command "${command}". Use "assess".`);
  }

  const options: CliOptions = {
    output: "text",
    readOnly: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--input":
      case "-i":
        options.inputPath = readValue(args, ++index, arg);
        break;
      case "--output":
      case "--format": {
        const output = readValue(args, ++index, arg);
        if (output !== "json" && output !== "text") {
          throw new CliUsageError(`Unsupported output format "${output}". Use "json" or "text".`);
        }
        options.output = output;
        break;
      }
      case "--memory":
        options.memoryPath = readValue(args, ++index, arg);
        break;
      case "--read-only":
        options.readOnly = true;
        break;
      case "--write-memory":
        options.readOnly = false;
        break;
      case "--help":
      case "-h":
        throw new CliHelp();
      default:
        throw new CliUsageError(`Unknown option "${arg}".`);
    }
  }

  if (!options.readOnly) {
    throw new CliUsageError("Memory writes are not supported by the assess command.");
  }

  return options;
}

export function runAssessmentCommand(
  input: unknown,
  options: CliOptions,
  runtime: Pick<CliRuntime, "cwd" | "readFile" | "fileExists"> = nodeRuntime(),
): AssessmentOutput {
  const memory = loadMemory(options, runtime);
  const assessmentInput = attachMemoryRecords(input, memory.records);
  const result = assessArchitecture(assessmentInput);
  return {
    result: {
      ...result,
      memory: {
        status: memory.status,
        decisionCount: memory.records.length,
      },
    },
    memoryDiagnostics: memory.diagnostics,
  };
}

export function renderAssessmentOutput(
  output: AssessmentOutput,
  format: CliOutputFormat,
): string {
  if (format === "json") {
    return JSON.stringify(output, null, 2);
  }
  if (format !== "text") {
    throw new CliUsageError(`Unsupported output format "${format}". Use "json" or "text".`);
  }

  const { result, memoryDiagnostics } = output;
  const lines = [
    `Status: ${result.status}`,
    `Intervention: ${result.intervention}`,
    `Action: ${result.action}`,
    `Reason: ${result.reason}`,
    `Memory: ${result.memory.status} (${result.memory.decisionCount} decision${result.memory.decisionCount === 1 ? "" : "s"})`,
  ];

  if (result.revisitAlerts.length > 0) {
    lines.push("Revisit alerts:");
    for (const alert of result.revisitAlerts) {
      lines.push(`- ${alert.decisionId}: matched "${alert.matchedCondition}" -> ${alert.recommendedAction}`);
    }
  }

  if (result.questions.length > 0) {
    lines.push("Questions:");
    for (const question of result.questions) {
      lines.push(`- ${question.prompt}`);
    }
  }

  if (result.evidence.length > 0) {
    lines.push("Evidence:");
    for (const evidence of result.evidence.slice(0, 8)) {
      const family = evidence.family ? `${evidence.family}/` : "";
      const category = evidence.category ? `:${evidence.category}` : "";
      lines.push(`- ${family}${evidence.source}${category}: ${evidence.summary}`);
    }
  }

  if (result.doNotAdd.length > 0) {
    lines.push("Do not add yet:");
    for (const item of result.doNotAdd) {
      lines.push(`- ${item}`);
    }
  }

  if (memoryDiagnostics.length > 0) {
    lines.push("Memory diagnostics:");
    for (const diagnostic of memoryDiagnostics) {
      lines.push(`- ${diagnostic.severity}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

export async function runCli(runtime: CliRuntime = nodeRuntime()): Promise<CliRunResult> {
  try {
    const options = parseCliArgs(runtime.argv);
    const rawInput = readInput(options, runtime);
    const parsedInput = parseJson(rawInput);
    const assessment = runAssessmentCommand(parsedInput, options, runtime);
    const rendered = renderAssessmentOutput(assessment, options.output);
    runtime.stdout(`${rendered}\n`);
    return { exitCode: 0, output: rendered };
  } catch (error) {
    if (error instanceof CliHelp) {
      const help = usage();
      runtime.stdout(`${help}\n`);
      return { exitCode: 0, output: help };
    }
    const message = formatError(error);
    runtime.stderr(`${message}\n`);
    return { exitCode: 1, error: message };
  }
}

export function assertRuntimeArtifactExists(
  artifactPath = defaultRuntimeArtifact,
  runtime: Pick<CliRuntime, "fileExists" | "cwd"> = nodeRuntime(),
): void {
  const absolute = resolve(runtime.cwd, artifactPath);
  if (!runtime.fileExists(absolute)) {
    throw new CliUsageError(`Missing bundled runtime artifact: ${artifactPath}. Run the CLI build first.`);
  }
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

class CliHelp extends Error {
  constructor() {
    super("help");
    this.name = "CliHelp";
  }
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`Missing value for ${flag}.`);
  }
  return value;
}

function readInput(options: CliOptions, runtime: CliRuntime): string {
  if (!options.inputPath || options.inputPath === "-") {
    return runtime.readStdin();
  }
  return runtime.readFile(resolve(runtime.cwd, options.inputPath));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliUsageError(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadMemory(
  options: CliOptions,
  runtime: Pick<CliRuntime, "cwd" | "readFile" | "fileExists">,
): {
  records: DecisionRecord[];
  diagnostics: MemoryDiagnostic[];
  status: "absent" | "loaded";
} {
  if (!options.memoryPath) {
    return {
      records: [],
      diagnostics: [
        {
          id: "memory-not-configured",
          severity: "info",
          message: "No project architecture memory path was supplied.",
        },
      ],
      status: "absent",
    };
  }

  const result = readDecisionMemory(resolve(runtime.cwd, options.memoryPath));
  return {
    records: result.records,
    diagnostics: result.diagnostics,
    status: result.records.length > 0 ? "loaded" : "absent",
  };
}

function attachMemoryRecords(input: unknown, records: DecisionRecord[]): AssessmentInput | Record<string, unknown> {
  if (isRecord(input)) {
    return {
      ...input,
      memoryRecords: records,
    };
  }
  return { event: input as Record<string, unknown>, memoryRecords: records };
}

function formatError(error: unknown): string {
  if (
    error instanceof AssessmentValidationError
    || error instanceof ProtocolValidationError
    || error instanceof TelemetryValidationError
  ) {
    return error.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function usage(): string {
  return [
    "Usage: archcoach assess --input <file|-> [--output json|text] [--memory <memory.jsonl>] [--read-only]",
    "",
    "Runs a read-only architecture assessment from a host-neutral event or telemetry bundle.",
  ].join("\n");
}

function nodeRuntime(): CliRuntime {
  return {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    readStdin: () => readFileSync(0, "utf8"),
    readFile: (path) => readFileSync(path, "utf8"),
    fileExists: (path) => existsSync(path),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}
