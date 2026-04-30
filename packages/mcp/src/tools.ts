import { basename, dirname, resolve } from "node:path";
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
import { checkRevisit, type RevisitAlert } from "../../kernel/src/revisit.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "../../kernel/src/telemetry.js";
import {
  TelemetryValidationError,
  type ArchitecturalTelemetryBundle,
} from "../../kernel/src/telemetryTypes.js";

export type ArchitectureCoachToolName =
  | "architecture.assess_change"
  | "architecture.plan_interview"
  | "architecture.apply_interview_answers"
  | "architecture.horizon_scan"
  | "architecture.review_structure"
  | "architecture.record_decision"
  | "architecture.check_revisit_triggers"
  | "architecture.get_memory"
  | "architecture.scan_repository";

export type ToolErrorCode =
  | "invalid_input"
  | "invalid_telemetry"
  | "invalid_interview_answer"
  | "kernel_unavailable"
  | "memory_failure";

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
    "Return structured architecture guidance for typed telemetry or a legacy host event. Prefer typed telemetry when available. This tool never writes memory.",
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
];

export function listArchitectureTools(): ToolDescriptor[] {
  return architectureTools;
}

export function invokeArchitectureTool(
  name: ArchitectureCoachToolName,
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): ToolResult {
  try {
    switch (name) {
      case "architecture.assess_change":
        return success(name, assessChange(input, runtime));
      case "architecture.plan_interview":
        return success(name, planInterview(input));
      case "architecture.apply_interview_answers":
        return success(name, applyInterviewAnswers(input));
      case "architecture.horizon_scan":
        return success(name, horizonScan(input, runtime));
      case "architecture.review_structure":
        return success(name, reviewStructure(input, runtime));
      case "architecture.record_decision":
        return success(name, recordDecision(input, runtime));
      case "architecture.check_revisit_triggers":
        return success(name, checkRevisitTriggers(input, runtime));
      case "architecture.get_memory":
        return success(name, getMemory(input, runtime));
      case "architecture.scan_repository":
        return success(name, scanRepository(input));
      default:
        return failure(name, {
          code: "invalid_input",
          message: `Unsupported architecture tool ${(name as string) || "unknown"}.`,
        });
    }
  } catch (error) {
    return failure(name, errorToToolError(error));
  }
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
): DecisionResult {
  const value = requireRecord(input, "input");
  const repoRoot = readRepoRoot(value, runtime);
  const record = assertDecisionRecord(value.decision);
  const memoryOptions = readMemoryOptions(value);
  const memoryPath = runtime.appendDecision
    ? runtime.appendDecision(repoRoot, record, memoryOptions)
    : appendDecision(repoRoot, record, memoryOptions);
  return { written: true, record, memoryPath };
}

export function checkRevisitTriggers(
  input: unknown,
  runtime: ArchitectureToolRuntime = {},
): RevisitAlert[] {
  const value = withOptionalMemory(input, runtime);
  const normalized = normalizeAssessmentInput(value);
  return checkRevisit({
    event: normalized.event,
    records: normalized.memoryRecords,
    telemetry: normalized.telemetry,
  });
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
    ? value.memoryRecords.filter((record): record is DecisionRecord => isRecord(record))
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
