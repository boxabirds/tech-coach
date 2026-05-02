import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assessArchitecture,
  AssessmentValidationError,
  normalizeAssessmentInput,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import {
  applyBaselineAnswers,
} from "../../kernel/src/baselineMerge.js";
import {
  planBaselineInterviewQuestions,
} from "../../kernel/src/baselineInterview.js";
import {
  type ArchitectureBaseline,
  type BaselineAnswerMergeInput,
  BaselineValidationError,
  type BaselineQuestion,
} from "../../kernel/src/baselineTypes.js";
import {
  assertDecisionRecord,
  DecisionRecordValidationError,
  ProjectMemoryStore,
  readDecisionMemory,
  type DecisionRecord,
  type MemoryDiagnostic,
} from "../../kernel/src/memory.js";
import { normalizeHostEvent } from "../../kernel/src/normalize.js";
import { ProtocolValidationError } from "../../kernel/src/protocol.js";
import type { CoachAction } from "../../kernel/src/protocol.js";
import { type RevisitAlert } from "../../kernel/src/revisit.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "../../kernel/src/telemetry.js";
import {
  buildUsageReview,
  classifyUsageEvent,
  type UsageReview,
} from "../../kernel/src/usageEvents.js";
import {
  TelemetryValidationError,
  type ArchitecturalTelemetryBundle,
} from "../../kernel/src/telemetryTypes.js";
import {
  AssessmentGraphError,
  buildAssessmentGraph,
  createAssessmentIndex,
  getAssessmentNode,
  queryAssessmentGraph,
  type AssessmentIndexResult,
  type GraphPage,
  type GraphQuery,
  type NodeDetail,
  type NodeDetailQuery,
  type AssessmentGraphNodeType,
  type AssessmentGraphRelation,
} from "../../persistence/src/assessmentGraph.js";
import {
  applyPersistedAnswer,
  captureAssessment,
  confirmPersistedDecision,
  openPersistenceStore,
  type CaptureAssessmentResult,
} from "../../persistence/src/index.js";

export type ArchitectureCoachToolName =
  | "architecture.assess_change"
  | "architecture.capture_assessment"
  | "architecture.query_assessment_graph"
  | "architecture.get_assessment_node"
  | "architecture.plan_interview"
  | "architecture.apply_interview_answers"
  | "architecture.answer_question"
  | "architecture.horizon_scan"
  | "architecture.review_structure"
  | "architecture.record_decision"
  | "architecture.check_revisit_triggers"
  | "architecture.get_memory"
  | "architecture.scan_repository"
  | "architecture.review_usage";

export type ToolErrorCode =
  | "invalid_input"
  | "invalid_telemetry"
  | "invalid_interview_answer"
  | "kernel_unavailable"
  | "memory_failure"
  | "persistence_failure";

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  field?: string;
};

export type ToolSuccess<T> = {
  ok: true;
  tool: ArchitectureCoachToolName;
  result: T;
};

export type ToolFailure = {
  ok: false;
  tool: ArchitectureCoachToolName;
  error: ToolError;
};

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export type ToolDescriptor = {
  name: ArchitectureCoachToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AssessmentToolResult = {
  assessment: AssessmentResult;
  interview: {
    hostMediated: true;
    questions: BaselineQuestion[];
    answerContract: {
      tool: "architecture.apply_interview_answers";
      answerShape: "BaselineAnswer[]";
      instruction: string;
    };
  };
};

export type MemorySummary = {
  records: DecisionRecord[];
  diagnostics: MemoryDiagnostic[];
};

export type DecisionResult = {
  written: boolean;
  record: DecisionRecord;
  memoryPath: string;
};

export type HorizonScanResult = {
  action: CoachAction;
  reason: string;
  concerns: ArchitectureBaseline["concerns"];
  doNotAdd: string[];
};

export type StructureReviewResult = {
  baseline: ArchitectureBaseline;
  evidence: AssessmentResult["evidence"];
  revisitAlerts: RevisitAlert[];
  doNotAdd: string[];
};

export type CaptureAssessmentToolResult = CaptureAssessmentResult | AssessmentIndexResult;

export type ArchitectureToolRuntime = {
  cwd?: string;
  readMemory?: (path: string) => MemorySummary;
  appendDecision?: (repoRoot: string, record: DecisionRecord, options?: MemoryOptions) => string;
};

type MemoryOptions = {
  memoryPath?: string;
  memoryDir?: string;
  memoryFile?: string;
};

export const architectureTools: ToolDescriptor[] = [
  descriptor(
    "architecture.assess_change",
    "Return structured architecture guidance for typed telemetry or a normalized host event. Prefer typed telemetry when available. This tool never writes memory.",
  ),
  descriptor(
    "architecture.capture_assessment",
    "Run a durable brownfield assessment and return a bounded graph index. Full details stay in .ceetrix/tech-lead artifacts and can be loaded through graph navigation tools.",
  ),
  descriptor(
    "architecture.query_assessment_graph",
    "Read a bounded page of the persisted assessment graph by node type, concern, relation, limit, and cursor.",
  ),
  descriptor(
    "architecture.get_assessment_node",
    "Read one persisted assessment graph node plus a bounded page of related edges.",
  ),
  descriptor(
    "architecture.plan_interview",
    "Return focused host-mediated architecture questions for an existing baseline. The host asks the user and must not invent answers.",
  ),
  descriptor(
    "architecture.apply_interview_answers",
    "Apply host-collected BaselineAnswer objects to a baseline and return the updated baseline. Durable memory writes require architecture.record_decision.",
  ),
  descriptor(
    "architecture.answer_question",
    "Persist a host-collected answer or skipped question to the repo-local Tech Lead assessment pack and regenerate artifacts.",
  ),
  descriptor(
    "architecture.horizon_scan",
    "Summarize maturity pressure and likely next architectural movement from an assessment input without writing memory.",
  ),
  descriptor(
    "architecture.review_structure",
    "Return baseline, evidence, revisit alerts, and explicit non-actions for a structure review without writing memory.",
  ),
  descriptor(
    "architecture.record_decision",
    "Append an explicit DecisionRecord to project memory. This is the only tool in this surface that writes durable memory.",
  ),
  descriptor(
    "architecture.check_revisit_triggers",
    "Check current event or telemetry against prior decisions and return revisit alerts without writing memory.",
  ),
  descriptor(
    "architecture.get_memory",
    "Read project architecture memory and return records plus diagnostics.",
  ),
  descriptor(
    "architecture.scan_repository",
    "Convert supplied host event and optional evidence into a typed architectural telemetry bundle.",
  ),
  descriptor(
    "architecture.review_usage",
    "Summarize local Tech Lead usage events by repository, session, source, engagement type, and missed-engagement candidates.",
  ),
];

export function listArchitectureTools(): ToolDescriptor[] {
  return architectureTools;
}

export function invokeArchitectureTool(
  name: ArchitectureCoachToolName,
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): ToolResult {
  let result: ToolResult;
  try {
    switch (name) {
      case "architecture.assess_change":
        result = success(name, assessChange(input, runtime));
        break;
      case "architecture.capture_assessment":
        result = success(name, captureAssessmentTool(input, runtime));
        break;
      case "architecture.query_assessment_graph":
        result = success(name, queryAssessmentGraphTool(input, runtime));
        break;
      case "architecture.get_assessment_node":
        result = success(name, getAssessmentNodeTool(input, runtime));
        break;
      case "architecture.plan_interview":
        result = success(name, planInterview(input));
        break;
      case "architecture.apply_interview_answers":
        result = success(name, applyInterviewAnswers(input));
        break;
      case "architecture.answer_question":
        result = success(name, answerQuestion(input, runtime));
        break;
      case "architecture.horizon_scan":
        result = success(name, horizonScan(input, runtime));
        break;
      case "architecture.review_structure":
        result = success(name, reviewStructure(input, runtime));
        break;
      case "architecture.record_decision":
        result = success(name, recordDecision(input, runtime));
        break;
      case "architecture.check_revisit_triggers":
        result = success(name, checkRevisitTriggers(input, runtime));
        break;
      case "architecture.get_memory":
        result = success(name, getMemory(input, runtime));
        break;
      case "architecture.scan_repository":
        result = success(name, scanRepository(input));
        break;
      case "architecture.review_usage":
        result = success(name, reviewUsage(input, runtime));
        break;
      default:
        result = failure(name, {
          code: "invalid_input",
          message: `Unsupported architecture tool ${(name as string) || "unknown"}.`,
        });
    }
  } catch (error) {
    result = failure(name, errorToToolError(error));
  }
  recordMcpUsage(name, input, runtime, result);
  return result;
}

export function assessChange(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): AssessmentToolResult {
  const assessmentInput = withOptionalMemory(input, runtime);
  const assessment = assessArchitecture(assessmentInput);
  return {
    assessment,
    interview: {
      hostMediated: true,
      questions: assessment.questions,
      answerContract: {
        tool: "architecture.apply_interview_answers",
        answerShape: "BaselineAnswer[]",
        instruction: "Ask the human user these questions conversationally, then call architecture.apply_interview_answers with the returned structured answers. Do not answer on the user's behalf.",
      },
    },
  };
}

export function captureAssessmentTool(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): CaptureAssessmentToolResult {
  const value = requireRecord(input, "input");
  const result = captureAssessment({
    ...value,
    repoRoot: readActiveProjectRoot(value) ?? runtime.cwd,
  });
  return wantsFullCaptureResult(value) ? result : compactCaptureAssessmentResult(result);
}

export function queryAssessmentGraphTool(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): GraphPage {
  const value = requireRecord(input, "input");
  const loaded = loadPersistedGraph(value, runtime);
  return queryAssessmentGraph(loaded.graph, {
    runId: loaded.graph.runId,
    nodeTypes: readStringArray(value.nodeTypes) as AssessmentGraphNodeType[] | undefined,
    concerns: readStringArray(value.concerns) as never,
    relations: readStringArray(value.relations) as AssessmentGraphRelation[] | undefined,
    purpose: readString(value.purpose),
    limit: readBoundedNumber(value.limit),
    cursor: readString(value.cursor),
  } satisfies GraphQuery);
}

export function getAssessmentNodeTool(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): NodeDetail {
  const value = requireRecord(input, "input");
  const loaded = loadPersistedGraph(value, runtime);
  const nodeId = readString(value.nodeId);
  if (!nodeId) {
    throw new ToolInputError("input.nodeId", "is required");
  }
  return getAssessmentNode(loaded.graph, {
    runId: loaded.graph.runId,
    nodeId,
    includeEdges: typeof value.includeEdges === "boolean" ? value.includeEdges : true,
    edgeLimit: readBoundedNumber(value.edgeLimit),
    edgeCursor: readString(value.edgeCursor),
  } satisfies NodeDetailQuery);
}

export function planInterview(input: unknown): BaselineQuestion[] {
  const value = requireRecord(input, "input");
  if (!isRecord(value.baseline)) {
    throw new ToolInputError("input.baseline", "is required");
  }
  return planBaselineInterviewQuestions({
    baseline: value.baseline as ArchitectureBaseline,
    telemetry: isTelemetryBundle(value.telemetry)
      ? assertValidTelemetryBundle(value.telemetry)
      : undefined,
  }, readLimit(value.limit));
}

export function applyInterviewAnswers(input: unknown): ArchitectureBaseline {
  const value = requireRecord(input, "input");
  if (!isRecord(value.baseline)) {
    throw new ToolInputError("input.baseline", "is required");
  }
  if (!Array.isArray(value.questions)) {
    throw new ToolInputError("input.questions", "must be an array");
  }
  if (!Array.isArray(value.answers)) {
    throw new ToolInputError("input.answers", "must be an array of host-collected answers");
  }

  return applyBaselineAnswers(value as BaselineAnswerMergeInput);
}

export function answerQuestion(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): CaptureAssessmentToolResult {
  const value = requireRecord(input, "input");
  if (typeof value.questionId !== "string" || value.questionId.trim().length === 0) {
    throw new ToolInputError("input.questionId", "is required");
  }
  const result = applyPersistedAnswer({
    ...value,
    repoRoot: readActiveProjectRoot(value) ?? runtime.cwd,
    questionId: value.questionId,
    action: typeof value.action === "string" ? value.action as never : "confirm",
    value: readString(value.value),
    note: readString(value.note),
  });
  return wantsFullCaptureResult(value) ? result : compactCaptureAssessmentResult(result);
}

export function horizonScan(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): HorizonScanResult {
  const assessment = assessArchitecture(withOptionalMemory(input, runtime));
  return {
    action: assessment.action,
    reason: assessment.reason,
    concerns: assessment.baseline.concerns,
    doNotAdd: assessment.doNotAdd,
  };
}

export function reviewStructure(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): StructureReviewResult {
  const assessment = assessArchitecture(withOptionalMemory(input, runtime));
  return {
    baseline: assessment.baseline,
    evidence: assessment.evidence,
    revisitAlerts: assessment.revisitAlerts,
    doNotAdd: assessment.doNotAdd,
  };
}

export function recordDecision(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): DecisionResult | CaptureAssessmentToolResult {
  const value = requireRecord(input, "input");
  if (value.confirmed === true || value.persistence === "tech-lead") {
    const result = confirmPersistedDecision({
      ...value,
      repoRoot: readActiveProjectRoot(value) ?? runtime.cwd,
      decision: assertDecisionRecord(value.decision),
      confirmed: value.confirmed === true,
    });
  return wantsFullCaptureResult(value) ? result : compactCaptureAssessmentResult(result);
  }
  const repoRoot = readRepoRoot(value, runtime);
  const record = assertDecisionRecord(value.decision);
  const memoryOptions = readMemoryOptions(value);
  const memoryPath = runtime.appendDecision
    ? runtime.appendDecision(repoRoot, record, memoryOptions)
    : appendDecision(repoRoot, record, memoryOptions);
  return { written: true, record, memoryPath };
}

function compactCaptureAssessmentResult(result: CaptureAssessmentResult): AssessmentIndexResult {
  return createAssessmentIndex(result);
}

function wantsFullCaptureResult(value: Record<string, unknown>): boolean {
  return value.responseDetail === "full";
}

function loadPersistedGraph(
  value: Record<string, unknown>,
  runtime: ArchitectureToolRuntime,
) {
  const repoRoot = readRepoRoot(value, runtime);
  const store = openPersistenceStore(repoRoot, {
    ...(typeof value.persistenceDir === "string" ? { persistenceDir: value.persistenceDir } : {}),
    ...(typeof value.databaseFile === "string" ? { databaseFile: value.databaseFile } : {}),
  });
  try {
    const runId = readString(value.runId);
    const run = runId ? store.getRun(runId) : store.latestRun();
    if (!run) {
      throw new ToolInputError(runId ? "input.runId" : "input.repoRoot", "no persisted assessment run exists");
    }
    const answers = store.listAnswers();
    const decisions = store.listDecisions();
    const result: CaptureAssessmentResult = {
      durableRecordCreated: run.durableRecordCreated,
      storePath: store.databasePath,
      runId: run.runId,
      ...(run.previousRunId ? { previousRunId: run.previousRunId } : {}),
      assessment: run.assessment,
      ...(run.telemetry ? { telemetry: run.telemetry } : {}),
      openQuestions: run.assessment.questions,
      answeredQuestions: answers.filter((answer) => answer.status === "answered"),
      skippedQuestions: answers.filter((answer) => answer.status === "skipped"),
      decisions,
      artifactPaths: artifactPathsForStoreDir(store.storeDir),
      diagnostics: run.diagnostics,
      lifecycleState: run.lifecycleState,
    };
    return { graph: buildAssessmentGraph(result), run };
  } finally {
    store.close();
  }
}

function artifactPathsForStoreDir(storeDir: string): CaptureAssessmentResult["artifactPaths"] {
  return {
    latestAssessmentMd: join(storeDir, "latest-assessment.md"),
    latestAssessmentJson: join(storeDir, "latest-assessment.json"),
    questionsJson: join(storeDir, "questions.json"),
    evidenceJson: join(storeDir, "evidence.json"),
    nextActionsMd: join(storeDir, "next-actions.md"),
    decisionsJsonl: join(storeDir, "decisions.jsonl"),
    changesSinceLastMd: join(storeDir, "changes-since-last.md"),
  };
}

export function checkRevisitTriggers(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): RevisitAlert[] {
  const value = withOptionalMemory(input, runtime);
  return assessArchitecture(value).revisitAlerts;
}

export function getMemory(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): MemorySummary {
  const value = requireRecord(input, "input");
  const memoryPath = readMemoryPath(value, runtime);
  const summary = runtime.readMemory
    ? runtime.readMemory(memoryPath)
    : readDecisionMemory(memoryPath);
  const error = summary.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) {
    throw new MemoryToolError(error.message, error.source);
  }
  return summary;
}

export function scanRepository(input: unknown): ArchitecturalTelemetryBundle {
  const value = requireRecord(input, "input");
  const rawEvent = value.event ?? value;
  const event = normalizeHostEvent(rawEvent as Record<string, unknown>);
  return telemetryFromEvent(event, {
    capturedAt: readString(value.capturedAt),
    correlationId: readString(value.correlationId),
  });
}

export function reviewUsage(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): UsageReview {
  const value = requireRecord(input, "input");
  const repoRoot = readRepoRoot(value, runtime);
  const store = openPersistenceStore(repoRoot, {
    ...(typeof value.persistenceDir === "string" ? { persistenceDir: value.persistenceDir } : {}),
    ...(typeof value.databaseFile === "string" ? { databaseFile: value.databaseFile } : {}),
  });
  try {
    const events = store.listUsageEvents({
      repoRoot,
      repoId: readString(value.repoId),
      sessionId: readString(value.sessionId),
      since: readString(value.since),
      until: readString(value.until),
    });
    return buildUsageReview(events, {
      repoRoot,
      repoId: readString(value.repoId),
      sessionId: readString(value.sessionId),
      since: readString(value.since),
      until: readString(value.until),
      limit: readBoundedNumber(value.limit),
      cursor: readString(value.cursor),
    });
  } finally {
    store.close();
  }
}

function withOptionalMemory(
  input: unknown,
  runtime: ArchitectureToolRuntime,
): AssessmentInput {
  const value = input;
  if (!isRecord(value)) {
    return value as AssessmentInput;
  }
  const memoryPath = typeof value.memoryPath === "string"
    ? value.memoryPath
    : undefined;
  if (!memoryPath) {
    return value as AssessmentInput;
  }

  const summary = getMemory(value, runtime);
  return {
    ...value,
    memoryRecords: [
      ...readExistingMemoryRecords(value),
      ...summary.records,
    ],
  };
}

function readExistingMemoryRecords(value: Record<string, unknown>): DecisionRecord[] {
  return Array.isArray(value.memoryRecords)
    ? value.memoryRecords.map((record) => assertDecisionRecord(record))
    : [];
}

function descriptor(name: ArchitectureCoachToolName, description: string): ToolDescriptor {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: true,
      description,
    },
  };
}

function success<T>(tool: ArchitectureCoachToolName, result: T): ToolSuccess<T> {
  return { ok: true, tool, result };
}

function failure(tool: ArchitectureCoachToolName, error: ToolError): ToolFailure {
  return { ok: false, tool, error };
}

function readLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function readBoundedNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ToolInputError("input.filter", "must be an array of strings");
  }
  return value;
}

function readRepoRoot(
  value: Record<string, unknown>,
  _runtime: ArchitectureToolRuntime,
): string {
  const repoRoot = readActiveProjectRoot(value);
  if (!repoRoot || repoRoot.trim().length === 0) {
    throw new ToolInputError("input.repoRoot", "is required");
  }
  return repoRoot;
}

function readMemoryPath(
  value: Record<string, unknown>,
  runtime: ArchitectureToolRuntime,
): string {
  const repoRoot = readRepoRoot(value, runtime);
  if (typeof value.memoryPath === "string" && value.memoryPath.trim().length > 0) {
    return resolve(repoRoot, value.memoryPath);
  }
  return new ProjectMemoryStore(repoRoot, readMemoryOptions(value)).memoryPath;
}

function readMemoryOptions(value: Record<string, unknown>): MemoryOptions {
  return {
    ...(typeof value.memoryPath === "string" ? { memoryPath: value.memoryPath } : {}),
    ...(typeof value.memoryDir === "string" ? { memoryDir: value.memoryDir } : {}),
    ...(typeof value.memoryFile === "string" ? { memoryFile: value.memoryFile } : {}),
  };
}

function appendDecision(
  repoRoot: string,
  record: DecisionRecord,
  options: MemoryOptions,
): string {
  const explicitMemoryPath = options.memoryPath
    ? resolve(repoRoot, options.memoryPath)
    : undefined;
  const store = explicitMemoryPath
    ? new ProjectMemoryStore(dirname(explicitMemoryPath), {
      memoryDir: ".",
      memoryFile: basename(explicitMemoryPath),
    })
    : new ProjectMemoryStore(repoRoot, options);
  store.append(record);
  return store.memoryPath;
}

function recordMcpUsage(
  name: ArchitectureCoachToolName,
  input: unknown,
  runtime: ArchitectureToolRuntime,
  result: ToolResult,
): void {
  if (!isRecord(input)) {
    return;
  }
  const repoRoot = readActiveProjectRoot(input);
  if (!repoRoot) {
    return;
  }
  const usage = classifyUsageEvent({
    source: "mcp",
    toolName: name,
    error: !result.ok,
  });
  try {
    const store = openPersistenceStore(repoRoot, {
      ...(typeof input.persistenceDir === "string" ? { persistenceDir: input.persistenceDir } : {}),
      ...(typeof input.databaseFile === "string" ? { databaseFile: input.databaseFile } : {}),
    });
    try {
      store.appendUsageEvent({
        id: `usage-mcp-${name.replace(/[^a-zA-Z0-9]+/g, "-")}-${randomUUID()}`,
        repoRoot,
        sessionId: readString(input.sessionId),
        source: "mcp",
        engagementType: usage.engagementType,
        outcome: usage.outcome,
        metadata: {
          ...usage.metadata,
          ok: result.ok,
          ...(result.ok ? {} : { errorCode: result.error.code }),
        },
      });
    } finally {
      store.close();
    }
  } catch {
    // Usage logging must never alter MCP tool behavior.
  }
}

function readActiveProjectRoot(value: Record<string, unknown>): string | undefined {
  if (typeof value.repoRoot === "string" && value.repoRoot.trim().length > 0) {
    return value.repoRoot;
  }
  if (isRecord(value.event)) {
    return normalizeHostEvent(value.event).cwd;
  }
  if (typeof value.cwd === "string" && value.cwd.trim().length > 0) {
    return value.cwd;
  }
  const telemetry = isTelemetryBundle(value.telemetry) ? value.telemetry : undefined;
  const telemetryCwd = telemetry?.lifecycle.find((signal) =>
    signal.status === "present"
    && typeof signal.payload.cwd === "string"
    && signal.payload.cwd.trim().length > 0
  )?.payload.cwd;
  return telemetryCwd;
}

function isTelemetryBundle(value: unknown): value is ArchitecturalTelemetryBundle {
  if (!isRecord(value)) {
    return false;
  }
  return ["lifecycle", "repository", "change", "test", "memory", "runtime", "diagnostics"]
    .every((key) => Array.isArray(value[key]));
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ToolInputError(field, "must be an object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function errorToToolError(error: unknown): ToolError {
  if (error instanceof ToolInputError) {
    return { code: "invalid_input", message: error.message, field: error.field };
  }
  if (error instanceof MemoryToolError) {
    return { code: "memory_failure", message: error.message, field: error.field };
  }
  if (error instanceof TelemetryValidationError) {
    const issue = error.issues[0];
    return {
      code: "invalid_telemetry",
      message: error.message,
      field: issue?.field,
    };
  }
  if (error instanceof DecisionRecordValidationError) {
    const issue = error.issues[0];
    return {
      code: "invalid_input",
      message: error.message,
      field: issue?.field,
    };
  }
  if (error instanceof BaselineValidationError) {
    const issue = error.issues[0];
    return {
      code: "invalid_interview_answer",
      message: error.message,
      field: issue?.field,
    };
  }
  if (error instanceof ProtocolValidationError || error instanceof AssessmentValidationError) {
    const issue = error.issues[0];
    return {
      code: "invalid_input",
      message: error.message,
      field: issue?.field,
    };
  }
  if (error instanceof AssessmentGraphError) {
    return { code: "invalid_input", message: error.message, field: error.field };
  }
  if (error instanceof Error) {
    return { code: "kernel_unavailable", message: error.message };
  }
  return { code: "kernel_unavailable", message: String(error) };
}

class ToolInputError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ToolInputError";
    this.field = field;
  }
}

class MemoryToolError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "MemoryToolError";
    this.field = field;
  }
}
