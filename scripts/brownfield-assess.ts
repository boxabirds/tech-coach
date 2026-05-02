import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessArchitecture } from "../packages/kernel/src/assessment.js";
import { readDecisionMemory, type DecisionRecord } from "../packages/kernel/src/memory.js";
import type { CoachEventEnvelope } from "../packages/kernel/src/protocol.js";
import type { AssessmentToolResult, ToolResult } from "../packages/mcp/src/tools.js";
import {
  captureAssessment,
  type CaptureAssessmentResult,
} from "../packages/persistence/src/index.js";
import { architectureShapeProvider } from "../packages/signals/src/architectureShape.js";
import { claimCandidateProvider } from "../packages/signals/src/claimCandidates.js";
import { codeIntelligenceProvider } from "../packages/signals/src/codeIntelligence.js";
import { configBoundaryProvider } from "../packages/signals/src/config.js";
import { diagnosticsProvider } from "../packages/signals/src/diagnostics.js";
import { fileTreeProvider } from "../packages/signals/src/fileTree.js";
import { gitDiffProvider } from "../packages/signals/src/gitDiff.js";
import { collectHistoryInteractionEvidenceFromProject } from "../packages/signals/src/historyProviders.js";
import type { OptionalSignalResult, SignalContext } from "../packages/signals/src/index.js";
import { runOptionalSignalProviders } from "../packages/signals/src/providerRunner.js";

type Args = {
  repo: string;
  request: string;
  json: boolean;
  claude: boolean;
  direct: boolean;
  capture: boolean;
  codeIntelCommand?: string;
  codeIntelArgs: string[];
  ceetrixHistoryPaths: string[];
  maxFiles: number;
  maxRecords: number;
};

type BrownfieldToolResult = {
  assessment: ReturnType<typeof assessArchitecture>;
  interview?: AssessmentToolResult["interview"];
  capture?: CaptureAssessmentResult;
};

const defaultRequest = "Assess this brownfield repository and recommend the next architecture move.";
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
  "chrome_profile",
  "Code Cache",
  "CacheStorage",
  "GPUCache",
  "Service Worker",
  "target",
]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repo = resolve(args.repo);
  const codeIntelCommand = args.codeIntelCommand ?? defaultCodeIntelligenceCommand();
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    throw new Error(`Repository path does not exist or is not a directory: ${repo}`);
  }

  const knownFiles = listKnownFiles(repo, args.maxFiles);
  const changedFiles = listChangedFiles(repo);
  const testSummary = readTestSummary(repo);
  const context: SignalContext = {
    cwd: repo,
    changedFiles,
    knownFiles,
    userRequest: args.request,
    recentRequests: [args.request],
    testSummary,
  };

  const providerResult = await runOptionalSignalProviders(
    context,
    [
      fileTreeProvider,
      architectureShapeProvider,
      claimCandidateProvider,
      gitDiffProvider,
      configBoundaryProvider,
      diagnosticsProvider,
      codeIntelligenceProvider({
        command: codeIntelCommand,
        args: args.codeIntelArgs,
        timeoutMs: 30_000,
      }),
    ],
    {
      capturedAt: new Date().toISOString(),
      correlationId: "brownfield-integration",
    },
  );
  const history = await collectHistoryInteractionEvidenceFromProject({
    cwd: repo,
    currentRequest: args.request,
    ceetrixHistoryPaths: args.ceetrixHistoryPaths,
    limits: {
      maxRecords: args.maxRecords,
      maxTranscriptFiles: 8,
    },
  });
  const optionalSignals: OptionalSignalResult[] = [
    ...providerResult.evidence,
    ...history.evidence,
  ];
  const memoryRecords = readMemoryRecords(repo);
  const event: CoachEventEnvelope = {
    host: "brownfield-integration",
    event: "manual-brownfield-assessment",
    cwd: repo,
    userRequest: args.request,
    recentRequests: [args.request],
    changedFiles,
    repoSignals: {
      status: "present",
      evidence: [
        `known files: ${knownFiles.length}`,
        `changed files: ${changedFiles.length}`,
        `brownfield history diagnostics: ${history.diagnostics.length}`,
      ],
    },
    memoryRefs: memoryRecords.map((record) => record.id),
    priorDecisions: [],
    optionalSignals,
  };
  const assessmentInput = { event, memoryRecords };
  const executionPath = args.capture
    ? (args.direct ? "direct-capture" : "mcp-capture")
    : (args.direct ? "direct-kernel" : "mcp");
  const assessmentToolResult: BrownfieldToolResult = args.capture
    ? captureAssessmentResult(repo, assessmentInput, args.direct)
    : args.direct
      ? { assessment: assessArchitecture(assessmentInput), interview: undefined }
      : assessViaMcp(repo, assessmentInput);
  const result = assessmentToolResult.assessment;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      repo,
      executionPath,
      knownFiles: knownFiles.length,
      changedFiles,
      historyDiagnostics: history.diagnostics,
      interviewQuestions: assessmentToolResult.interview?.questions ?? result.questions,
      assessment: result,
      capture: assessmentToolResult.capture,
    }, null, 2)}\n`);
  } else {
    renderText({
      repo,
      knownFiles: knownFiles.length,
      changedFiles,
      historyDiagnostics: history.diagnostics,
      result,
      executionPath,
      interviewQuestionCount: assessmentToolResult.interview?.questions.length ?? result.questions.length,
      pluginRoot: pluginRoot(),
      capture: assessmentToolResult.capture,
    });
  }

  if (args.claude) {
    const command = "claude";
    const commandArgs = ["--plugin-dir", pluginRoot()];
    process.stdout.write(`\nStarting Claude in ${repo} with local plugin ${pluginRoot()}...\n`);
    const launched = spawnSync(command, commandArgs, {
      cwd: repo,
      stdio: "inherit",
    });
    process.exit(launched.status ?? 1);
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    repo: process.cwd(),
    request: defaultRequest,
    json: false,
    claude: false,
    direct: false,
    capture: false,
    codeIntelArgs: [],
    ceetrixHistoryPaths: [],
    maxFiles: 1200,
    maxRecords: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--repo":
        args.repo = requiredValue(argv, ++index, arg);
        break;
      case "--request":
        args.request = requiredValue(argv, ++index, arg);
        break;
      case "--ceetrix-history":
        args.ceetrixHistoryPaths.push(resolve(requiredValue(argv, ++index, arg)));
        break;
      case "--max-files":
        args.maxFiles = Number.parseInt(requiredValue(argv, ++index, arg), 10);
        break;
      case "--max-records":
        args.maxRecords = Number.parseInt(requiredValue(argv, ++index, arg), 10);
        break;
      case "--json":
        args.json = true;
        break;
      case "--claude":
        args.claude = true;
        break;
      case "--direct":
        args.direct = true;
        break;
      case "--capture":
        args.capture = true;
        break;
      case "--code-intel-command":
        args.codeIntelCommand = requiredValue(argv, ++index, arg);
        break;
      case "--code-intel-arg":
        args.codeIntelArgs.push(requiredValue(argv, ++index, arg));
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

function listKnownFiles(repo: string, maxFiles: number): string[] {
  const fromGit = runGit(repo, ["ls-files"]);
  if (fromGit.length > 0) {
    return fromGit.filter((file) => !isIgnoredPath(file)).slice(0, maxFiles);
  }
  return walkFiles(repo, repo, maxFiles);
}

function listChangedFiles(repo: string): string[] {
  return Array.from(new Set([
    ...runGit(repo, ["diff", "--name-only", "HEAD"]),
    ...runGit(repo, ["ls-files", "--others", "--modified", "--exclude-standard"]),
  ])).filter((file) => !isIgnoredPath(file)).sort();
}

function captureAssessmentResult(
  repo: string,
  assessmentInput: { event: CoachEventEnvelope; memoryRecords: DecisionRecord[] },
  direct: boolean,
): BrownfieldToolResult {
  const capture = direct
    ? captureAssessment({ repoRoot: repo, ...assessmentInput })
    : captureViaMcp(repo, assessmentInput);
  return {
    assessment: capture.assessment,
    interview: {
      hostMediated: true,
      questions: capture.openQuestions,
      answerContract: {
        tool: "architecture.apply_interview_answers",
        answerShape: "BaselineAnswer[]",
        instruction: "Ask the human user these persisted questions, then call architecture.answer_question with each answer. Do not answer on the user's behalf.",
      },
    },
    capture,
  };
}

function assessViaMcp(
  repo: string,
  assessmentInput: { event: CoachEventEnvelope; memoryRecords: DecisionRecord[] },
): AssessmentToolResult {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "architecture.assess_change",
      arguments: assessmentInput,
    },
  };
  const processResult = spawnSync(join(pluginRoot(), "bin", "archcoach-mcp"), {
    cwd: repo,
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 16,
  });
  if (processResult.error) {
    throw processResult.error;
  }
  if (processResult.status !== 0) {
    throw new Error(`MCP server exited with ${processResult.status}: ${processResult.stderr.trim()}`);
  }

  const responseLine = processResult.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!responseLine) {
    throw new Error("MCP server returned no JSON-RPC response");
  }
  const response = JSON.parse(responseLine) as {
    error?: { message?: string };
    result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  };
  if (response.error) {
    throw new Error(`MCP JSON-RPC error: ${response.error.message ?? JSON.stringify(response.error)}`);
  }
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tools/call response did not include text content");
  }
  const toolResult = JSON.parse(text) as ToolResult<AssessmentToolResult>;
  if (!toolResult.ok) {
    throw new Error(`MCP tool failed: ${toolResult.error.code}: ${toolResult.error.message}`);
  }
  return toolResult.result;
}

function captureViaMcp(
  repo: string,
  assessmentInput: { event: CoachEventEnvelope; memoryRecords: DecisionRecord[] },
): CaptureAssessmentResult {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "architecture.capture_assessment",
      arguments: {
        repoRoot: repo,
        ...assessmentInput,
      },
    },
  };
  const processResult = spawnSync(join(pluginRoot(), "bin", "archcoach-mcp"), {
    cwd: repo,
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 16,
  });
  if (processResult.error) {
    throw processResult.error;
  }
  if (processResult.status !== 0) {
    throw new Error(`MCP server exited with ${processResult.status}: ${processResult.stderr.trim()}`);
  }
  const responseLine = processResult.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!responseLine) {
    throw new Error("MCP server returned no JSON-RPC response");
  }
  const response = JSON.parse(responseLine) as {
    error?: { message?: string };
    result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  };
  if (response.error) {
    throw new Error(`MCP JSON-RPC error: ${response.error.message ?? JSON.stringify(response.error)}`);
  }
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tools/call response did not include text content");
  }
  const toolResult = JSON.parse(text) as ToolResult<CaptureAssessmentResult>;
  if (!toolResult.ok) {
    throw new Error(`MCP tool failed: ${toolResult.error.code}: ${toolResult.error.message}`);
  }
  return toolResult.result;
}

function readTestSummary(repo: string): { status: string; summary: string } {
  const packagePath = join(repo, "package.json");
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

function readMemoryRecords(repo: string): DecisionRecord[] {
  const paths = [
    join(repo, ".archcoach", "memory.jsonl"),
    join(repo, ".ceetrix", "tech-lead", "memory.jsonl"),
  ];
  const records: DecisionRecord[] = [];
  for (const path of paths) {
    if (existsSync(path)) {
      records.push(...readDecisionMemory(path).records);
    }
  }
  return records;
}

function runGit(repo: string, args: string[]): string[] {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
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

function renderText(input: {
  repo: string;
  knownFiles: number;
  changedFiles: string[];
  historyDiagnostics: string[];
  result: ReturnType<typeof assessArchitecture>;
  executionPath: string;
  interviewQuestionCount: number;
  pluginRoot: string;
  capture?: CaptureAssessmentResult;
}): void {
  const lines = [
    "Ceetrix Tech Lead brownfield integration assessment",
    "======================================================",
    `Repo: ${input.repo}`,
    `Execution path: ${input.executionPath}`,
    `Files observed: ${input.knownFiles}`,
    `Changed files: ${input.changedFiles.length}`,
    `Interview questions returned: ${input.interviewQuestionCount}`,
    `Status: ${input.result.status}`,
    `Intervention: ${input.result.intervention}`,
    `Action: ${input.result.action}`,
    `Reason: ${input.result.reason}`,
    "",
    "What To Do Next",
    "---------------",
  ];

  if (input.result.revisitAlerts.length > 0) {
    lines.push("Revisit prior decisions:");
    for (const alert of input.result.revisitAlerts) {
      lines.push(`- ${alert.decisionId}: ${alert.recommendedAction} (${alert.matchedCondition})`);
    }
  }

  const patterns = input.result.principleGuidance.flatMap((guidance) =>
    guidance.patterns.map((pattern) => ({
      concern: guidance.concern,
      pattern,
      contract: guidance.contract,
    }))
  ).filter((item) => item.pattern.pattern !== "continue_locally");

  if (patterns.length > 0) {
    lines.push("Structural moves:");
    for (const item of patterns.slice(0, 6)) {
      lines.push(`- ${item.concern}/${item.pattern.pattern}: ${item.pattern.addNow}`);
      lines.push(`  Do not add yet: ${item.pattern.doNotAddYet}`);
      if (item.contract?.tests) {
        lines.push(`  Test boundary: ${item.contract.tests}`);
      }
    }
  }

  if (input.result.questions.length > 0) {
    lines.push("Questions to answer before relying on assumptions:");
    for (const question of input.result.questions) {
      lines.push(`- ${question.prompt}`);
      lines.push(`  Question id: ${question.id}`);
      lines.push(`  Why: ${question.reason}`);
      if (question.interactionGuidance) {
        lines.push(`  Style: ${question.interactionGuidance.questionStyle}`);
      }
    }
  } else if (patterns.length === 0 && input.result.revisitAlerts.length === 0) {
    lines.push("- No immediate structure move. Continue locally and rerun after a meaningful change.");
  }

  const concerns = input.result.baseline.concerns
    .filter((concern) => concern.facts.length > 0 || concern.unknowns.length > 0)
    .slice(0, 8);
  if (concerns.length > 0) {
    lines.push("", "Top Concerns", "------------");
    for (const concern of concerns) {
      lines.push(
        `- ${concern.concern}: ${concern.currentState}, confidence=${concern.confidence}, thresholds=${concern.thresholdCandidates.join(", ") || "none"}`,
      );
    }
  }

  if (input.result.evidence.length > 0) {
    lines.push("", "Evidence", "--------");
    for (const evidence of input.result.evidence.slice(0, 10)) {
      const family = evidence.family ? `${evidence.family}/` : "";
      const category = evidence.category ? `:${evidence.category}` : "";
      lines.push(`- ${family}${evidence.source}${category}: ${evidence.summary}`);
    }
  }

  if (input.historyDiagnostics.length > 0) {
    lines.push("", "History Diagnostics", "-------------------");
    for (const diagnostic of input.historyDiagnostics) {
      lines.push(`- ${diagnostic}`);
    }
  }

  if (input.capture) {
    lines.push("", "Durable Assessment Pack", "-----------------------");
    lines.push(`Source-of-truth store: ${input.capture.storePath}`);
    lines.push(`Lifecycle: ${input.capture.lifecycleState}`);
    if (input.capture.artifactPaths) {
      lines.push(`Latest assessment report: ${input.capture.artifactPaths.latestAssessmentMd}`);
      lines.push(`Question index: ${input.capture.artifactPaths.questionsJson}`);
      lines.push(`Next-action report: ${input.capture.artifactPaths.nextActionsMd}`);
    } else {
      lines.push("No generated report paths were created.");
    }
  }

  lines.push(
    "",
    "Claude Local Plugin Test",
    "------------------------",
    `cd ${shellQuote(input.repo)}`,
    `claude --plugin-dir ${shellQuote(input.pluginRoot)}`,
    "",
    "Then ask:",
    "Use Ceetrix Tech Lead to review this brownfield repository. If it returns interview questions, ask me rather than answering them yourself.",
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}

function pluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultCodeIntelligenceCommand(): string {
  return resolve(pluginRoot(), "scripts/complexity-to-code-intel.ts");
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function shellQuote(value: string): string {
  return isAbsolute(value) && /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function printUsage(): void {
  process.stdout.write([
    "Usage: test-brownfield.sh [repo] [options]",
    "",
    "Runs a read-only brownfield assessment from any repository.",
    "",
    "Options:",
    "  --repo <path>               Target repository. Defaults to current directory.",
    "  --request <text>            Current user request/context for the assessment.",
    "  --ceetrix-history <path>    Optional JSON/JSONL Ceetrix history fixture.",
    "  --max-files <n>             Maximum repository files to sample. Default: 1200.",
    "  --max-records <n>           Maximum history records to inspect. Default: 100.",
    "  --code-intel-command <cmd>  Required code intelligence JSON producer. Defaults to this repo's Rust tree-sitter adapter.",
    "  --code-intel-arg <arg>      Argument for the code intelligence producer. Repeatable.",
    "  --direct                    Bypass MCP and call the kernel directly.",
    "  --capture                   Write the repo-local .ceetrix/tech-lead assessment pack.",
    "  --json                      Print raw JSON assessment.",
    "  --claude                    Start Claude with this local plugin after assessment.",
    "  --help                      Show this help.",
    "",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
