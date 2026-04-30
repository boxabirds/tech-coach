import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  MaturityState,
  ProtocolValidationIssue,
} from "./protocol.js";
import type {
  MemorySignal,
  SignalEnvelope,
} from "./telemetryTypes.js";

export type DecisionRecordSource = "user" | "coach" | "agent";

export type DecisionRecord = {
  id: string;
  concern: string;
  decision: string;
  context: string;
  alternatives: string[];
  reason: string;
  risks: string[];
  state: MaturityState;
  revisitIf: string[];
  createdAt: string;
  source: DecisionRecordSource;
};

export type MemoryDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  source?: string;
};

export type MemoryReadResult = {
  records: DecisionRecord[];
  diagnostics: MemoryDiagnostic[];
};

export type ProjectMemoryStoreOptions = {
  memoryDir?: string;
  memoryFile?: string;
};

export class DecisionRecordValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "DecisionRecordValidationError";
    this.issues = issues;
  }
}

export class ProjectMemoryStore {
  readonly repoRoot: string;
  readonly memoryPath: string;

  constructor(repoRoot: string, options: ProjectMemoryStoreOptions = {}) {
    this.repoRoot = repoRoot;
    this.memoryPath = join(
      repoRoot,
      options.memoryDir ?? ".archcoach",
      options.memoryFile ?? "memory.jsonl",
    );
  }

  append(record: DecisionRecord): void {
    const issues = validateDecisionRecord(record);
    if (issues.length > 0) {
      throw new DecisionRecordValidationError(issues);
    }

    const existing = this.read();
    if (existing.records.some((item) => item.id === record.id)) {
      throw new DecisionRecordValidationError([
        { field: "id", message: `duplicate decision id ${record.id}` },
      ]);
    }

    mkdirSync(dirname(this.memoryPath), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    writeFileSync(this.memoryPath, line, { flag: "a", encoding: "utf8" });
  }

  list(): DecisionRecord[] {
    const result = this.read();
    const error = result.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (error) {
      throw new DecisionRecordValidationError([
        { field: error.source ?? "memory", message: error.message },
      ]);
    }
    return result.records;
  }

  read(): MemoryReadResult {
    return readDecisionMemory(this.memoryPath);
  }

  toMemorySignals(
    records = this.list(),
    options: { capturedAt?: string; correlationId?: string } = {},
  ): SignalEnvelope<MemorySignal>[] {
    return decisionRecordsToMemorySignals(records, options);
  }
}

export function readDecisionMemory(memoryPath: string): MemoryReadResult {
  let content: string;
  try {
    content = readFileSync(memoryPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        records: [],
        diagnostics: [
          {
            id: "memory-absent",
            severity: "info",
            source: memoryPath,
            message: "No project architecture memory was found.",
          },
        ],
      };
    }
    return {
      records: [],
      diagnostics: [
        {
          id: "memory-unreadable",
          severity: "error",
          source: memoryPath,
          message: `Project architecture memory could not be read: ${errorMessage(error)}`,
        },
      ],
    };
  }

  const records: DecisionRecord[] = [];
  const diagnostics: MemoryDiagnostic[] = [];
  const seenIds = new Set<string>();

  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (line.length === 0) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        diagnostics.push({
          id: `memory-line-${index + 1}-invalid-json`,
          severity: "error",
          source: memoryPath,
          message: `Memory line ${index + 1} is not valid JSON: ${errorMessage(error)}`,
        });
        return;
      }

      const issues = validateDecisionRecord(parsed, `line ${index + 1}`);
      if (issues.length > 0) {
        diagnostics.push({
          id: `memory-line-${index + 1}-invalid-record`,
          severity: "error",
          source: memoryPath,
          message: issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "),
        });
        return;
      }

      const record = parsed as DecisionRecord;
      if (seenIds.has(record.id)) {
        diagnostics.push({
          id: `memory-line-${index + 1}-duplicate-id`,
          severity: "error",
          source: memoryPath,
          message: `Duplicate decision id ${record.id}.`,
        });
        return;
      }

      seenIds.add(record.id);
      records.push(record);
    });

  return { records, diagnostics };
}

export function validateDecisionRecord(
  value: unknown,
  path = "record",
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: path, message: "must be an object" }];
  }

  requireString(value, "id", path, issues);
  requireString(value, "concern", path, issues);
  requireString(value, "decision", path, issues);
  requireString(value, "context", path, issues);
  requireString(value, "reason", path, issues);
  requireString(value, "createdAt", path, issues);

  if (!isStringArray(value.alternatives)) {
    issues.push({ field: `${path}.alternatives`, message: "must be an array of strings" });
  }
  if (!isStringArray(value.risks) || value.risks.length === 0) {
    issues.push({ field: `${path}.risks`, message: "must be a non-empty array of strings" });
  }
  if (!isStringArray(value.revisitIf) || value.revisitIf.length === 0) {
    issues.push({ field: `${path}.revisitIf`, message: "must be a non-empty array of strings" });
  }
  if (!isMaturityState(value.state)) {
    issues.push({ field: `${path}.state`, message: "must be a valid maturity state" });
  }
  if (!isDecisionSource(value.source)) {
    issues.push({ field: `${path}.source`, message: "must be user, coach, or agent" });
  }

  return issues;
}

export function assertDecisionRecord(value: unknown): DecisionRecord {
  const issues = validateDecisionRecord(value);
  if (issues.length > 0) {
    throw new DecisionRecordValidationError(issues);
  }
  return value as DecisionRecord;
}

export function decisionRecordsToMemorySignals(
  records: DecisionRecord[],
  options: { capturedAt?: string; correlationId?: string } = {},
): SignalEnvelope<MemorySignal>[] {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  return records.map((record) => ({
    id: `memory-${sanitizeId(record.id)}`,
    family: "memory",
    source: record.id,
    capturedAt,
    freshness: "current",
    confidence: "high",
    scope: "concern",
    status: "present",
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    payload: {
      id: record.id,
      concern: record.concern,
      decision: record.decision,
      context: record.context,
      reason: record.reason,
      risks: record.risks,
      state: record.state,
      source: record.source,
      createdAt: record.createdAt,
      revisitIf: record.revisitIf,
      evidence: memoryEvidence(record),
    },
  }));
}

export function decisionRecordsToSummaries(
  records: DecisionRecord[],
): DecisionRecordSummary[] {
  return records.map((record) => ({
    id: record.id,
    concern: record.concern,
    decision: record.decision,
    revisitIf: record.revisitIf,
  }));
}

export function withMemorySignals(
  event: CoachEventEnvelope,
  records: DecisionRecord[],
): CoachEventEnvelope {
  return {
    ...event,
    memoryRefs: Array.from(new Set([
      ...event.memoryRefs,
      ...records.map((record) => record.id),
    ])),
    priorDecisions: [
      ...event.priorDecisions,
      ...decisionRecordsToSummaries(records),
    ],
  };
}

function memoryEvidence(record: DecisionRecord): string[] {
  return [
    `decision: ${record.decision}`,
    `concern: ${record.concern}`,
    `context: ${record.context}`,
    `reason: ${record.reason}`,
    `risks: ${record.risks.join(", ")}`,
    `state: ${record.state}`,
    `revisit_if: ${record.revisitIf.join(", ")}`,
  ];
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ProtocolValidationIssue[],
): void {
  if (typeof value[key] !== "string" || value[key].trim().length === 0) {
    issues.push({ field: `${path}.${key}`, message: "must be a non-empty string" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isMaturityState(value: unknown): value is MaturityState {
  return typeof value === "string"
    && [
      "Exploratory",
      "Emerging",
      "Named",
      "Owned",
      "LoadBearing",
      "Hardened",
      "Operational",
      "Revisit",
    ].includes(value);
}

function isDecisionSource(value: unknown): value is DecisionRecordSource {
  return value === "user" || value === "coach" || value === "agent";
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
