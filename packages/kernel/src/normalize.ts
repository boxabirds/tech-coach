import {
  type ArchitectureInteractionContext,
  type CoachEventEnvelope,
  type DecisionRecordSummary,
  type HostLifecycleEvent,
  type OptionalSignalSummary,
  ProtocolValidationError,
  type ProtocolValidationIssue,
  type RepoSignalSummary,
  type TestSummary,
} from "./protocol.js";

const absentRepoSignals: RepoSignalSummary = Object.freeze({ status: "absent" });

export function normalizeHostEvent(raw: HostLifecycleEvent): CoachEventEnvelope {
  const issues: ProtocolValidationIssue[] = [];

  if (!isRecord(raw)) {
    throw new ProtocolValidationError([
      { field: "$", message: "event must be an object" },
    ]);
  }

  const host = readRequiredString(raw, ["host"], "host", issues);
  const event = readRequiredString(raw, ["event", "kind", "type"], "event", issues);
  const cwd = readRequiredString(raw, ["cwd", "workingDirectory"], "cwd", issues);

  const userRequest = readOptionalString(raw, ["userRequest", "user_request"]);
  const interactionContext = readInteractionContext(raw, issues);
  const payloadRequest = readPayloadPrompt(raw);
  const recentRequests = readStringArray(raw, "recentRequests", issues)
    ?? readStringArray(raw, "recent_requests", issues)
    ?? [];
  const changedFiles = readStringArray(raw, "changedFiles", issues)
    ?? readStringArray(raw, "changed_files", issues)
    ?? [];
  const memoryRefs = readStringArray(raw, "memoryRefs", issues)
    ?? readStringArray(raw, "memory_refs", issues)
    ?? [];
  const repoSignals = readRepoSignals(raw, issues);
  const testSummary = readOptionalRecord<TestSummary>(raw, "testSummary", issues)
    ?? readOptionalRecord<TestSummary>(raw, "test_summary", issues);
  const priorDecisions = readRecordArray<DecisionRecordSummary>(
    raw,
    "priorDecisions",
    issues,
  )
    ?? readRecordArray<DecisionRecordSummary>(raw, "prior_decisions", issues)
    ?? [];
  const optionalSignals = readRecordArray<OptionalSignalSummary>(
    raw,
    "optionalSignals",
    issues,
  )
    ?? readRecordArray<OptionalSignalSummary>(raw, "optional_signals", issues)
    ?? [];

  if (issues.length > 0) {
    throw new ProtocolValidationError(issues);
  }

  return {
    host,
    event,
    cwd,
    ...(interactionContext ? { interactionContext } : {}),
    ...(userRequest ?? payloadRequest
      ? { userRequest: userRequest ?? payloadRequest }
      : {}),
    recentRequests,
    changedFiles,
    repoSignals,
    ...(testSummary ? { testSummary } : {}),
    memoryRefs,
    priorDecisions,
    optionalSignals,
  };
}

function readInteractionContext(
  raw: Record<string, unknown>,
  issues: ProtocolValidationIssue[],
): ArchitectureInteractionContext | undefined {
  const value = raw.interactionContext ?? raw.interaction_context;
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "passive_baseline"
    || value === "requested_next_action"
    || value === "pending_change_assessment"
    || value === "risk_review"
    || value === "deployment_planning"
    || value === "architecture_decision"
  ) {
    return value;
  }
  issues.push({
    field: "interactionContext",
    message: "must be passive_baseline, requested_next_action, pending_change_assessment, risk_review, deployment_planning, or architecture_decision",
  });
  return undefined;
}

export const protocolSignalNormalizer = {
  normalize: normalizeHostEvent,
};

function readRequiredString(
  raw: Record<string, unknown>,
  keys: string[],
  field: string,
  issues: ProtocolValidationIssue[],
): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (value !== undefined) {
      issues.push({ field: key, message: "must be a non-empty string" });
      return "";
    }
  }
  issues.push({ field, message: "is required" });
  return "";
}

function readOptionalString(
  raw: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function readPayloadPrompt(raw: Record<string, unknown>): string | undefined {
  const payload = raw.payload;
  if (!isRecord(payload)) {
    return undefined;
  }

  const prompt = payload.prompt;
  return typeof prompt === "string" ? prompt : undefined;
}

function readStringArray(
  raw: Record<string, unknown>,
  field: string,
  issues: ProtocolValidationIssue[],
): string[] | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array of strings" });
    return undefined;
  }
  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex >= 0) {
    issues.push({
      field: `${field}[${invalidIndex}]`,
      message: "must be a string",
    });
    return undefined;
  }
  return value;
}

function readRepoSignals(
  raw: Record<string, unknown>,
  issues: ProtocolValidationIssue[],
): RepoSignalSummary {
  const value = raw.repoSignals ?? raw.repo_signals;
  if (value === undefined) {
    return { ...absentRepoSignals };
  }
  if (!isRecord(value)) {
    issues.push({ field: "repoSignals", message: "must be an object" });
    return { ...absentRepoSignals };
  }
  const status = value.status;
  if (
    status !== undefined
    && status !== "present"
    && status !== "absent"
    && status !== "failed"
  ) {
    issues.push({
      field: "repoSignals.status",
      message: "must be present, absent, or failed",
    });
  }
  return {
    status: status === "present" || status === "failed" ? status : "absent",
    ...value,
  } as RepoSignalSummary;
}

function readOptionalRecord<T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  field: string,
  issues: ProtocolValidationIssue[],
): T | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return undefined;
  }
  return value as T;
}

function readRecordArray<T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  field: string,
  issues: ProtocolValidationIssue[],
): T[] | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array of objects" });
    return undefined;
  }
  const invalidIndex = value.findIndex((item) => !isRecord(item));
  if (invalidIndex >= 0) {
    issues.push({
      field: `${field}[${invalidIndex}]`,
      message: "must be an object",
    });
    return undefined;
  }
  return value as T[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
