import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  OptionalSignalSummary,
  ProtocolValidationIssue,
  SignalStatus,
  TestSummary,
} from "./protocol.js";
import {
  type ArchitecturalTelemetryBundle,
  type ArchitecturalTelemetryNormalizer,
  type ChangeSignal,
  type LifecycleSignal,
  type MemorySignal,
  type RepositorySignal,
  type RuntimeSignal,
  type SignalEnvelope,
  type SignalFamily,
  type SignalScope,
  type TelemetryCompatibilityInput,
  type TelemetryConfidence,
  type TelemetryDiagnostic,
  type TelemetryFreshness,
  type TelemetrySignalStatus,
  type TelemetryValidationResult,
  TelemetryValidationError,
  type TestSignal,
} from "./telemetryTypes.js";
import type { OptionalSignalResult } from "../../signals/src/index.js";

type CompatibleEvidence = OptionalSignalResult | OptionalSignalSummary;

const signalFamilies: SignalFamily[] = [
  "lifecycle",
  "repository",
  "change",
  "test",
  "memory",
  "runtime",
];

export function emptyTelemetryBundle(): ArchitecturalTelemetryBundle {
  return {
    lifecycle: [],
    repository: [],
    change: [],
    test: [],
    memory: [],
    runtime: [],
    diagnostics: [],
  };
}

export function telemetryFromEvent(
  event: CoachEventEnvelope,
  options: { capturedAt?: string; correlationId?: string } = {},
): ArchitecturalTelemetryBundle {
  return telemetryFromEvidence({
    event,
    evidence: event.optionalSignals,
    testSummary: event.testSummary,
    priorDecisions: event.priorDecisions,
    capturedAt: options.capturedAt,
    correlationId: options.correlationId,
  });
}

export function telemetryFromEvidence(
  input: TelemetryCompatibilityInput,
): ArchitecturalTelemetryBundle {
  const bundle = emptyTelemetryBundle();
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const correlationId = input.correlationId ?? deriveCorrelationId(input.event);

  if (input.event) {
    addLifecycleSignal(bundle, input.event, capturedAt, correlationId);
    addRepositorySignalFromEvent(bundle, input.event, capturedAt, correlationId);
    addChangeSignalFromEvent(bundle, input.event, capturedAt, correlationId);
  }

  const testSummary = input.testSummary ?? input.event?.testSummary;
  if (testSummary) {
    addTestSignalFromSummary(bundle, testSummary, capturedAt, correlationId);
  }

  const decisions = input.priorDecisions ?? input.event?.priorDecisions ?? [];
  decisions.forEach((decision, index) =>
    addMemorySignalFromDecision(bundle, decision, index, capturedAt, correlationId)
  );

  const evidence = input.evidence ?? input.event?.optionalSignals ?? [];
  evidence.forEach((signal, index) =>
    addSignalFromOptionalEvidence(bundle, signal, index, capturedAt, correlationId)
  );

  return bundle;
}

export function validateTelemetryBundle(
  bundle: ArchitecturalTelemetryBundle,
): TelemetryValidationResult {
  const issues: ProtocolValidationIssue[] = [];

  if (!isRecord(bundle)) {
    return {
      valid: false,
      issues: [{ field: "$", message: "telemetry bundle must be an object" }],
    };
  }

  for (const family of signalFamilies) {
    const signals = bundle[family];
    if (!Array.isArray(signals)) {
      issues.push({ field: family, message: "must be an array" });
      continue;
    }
    signals.forEach((signal, index) =>
      validateSignalEnvelope(signal, `${family}[${index}]`, family, issues)
    );
  }

  const ids = new Set<string>();
  for (const family of signalFamilies) {
    for (const signal of bundle[family] as SignalEnvelope<unknown>[]) {
      if (!signal?.id) {
        continue;
      }
      if (ids.has(signal.id)) {
        issues.push({ field: signal.id, message: "duplicate telemetry signal id" });
      }
      ids.add(signal.id);
    }
  }

  if (!Array.isArray(bundle.diagnostics)) {
    issues.push({ field: "diagnostics", message: "must be an array" });
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidTelemetryBundle(
  bundle: ArchitecturalTelemetryBundle,
): ArchitecturalTelemetryBundle {
  const result = validateTelemetryBundle(bundle);
  if (!result.valid) {
    throw new TelemetryValidationError(result.issues);
  }
  return bundle;
}

export function evidenceFromTelemetry(
  bundle: ArchitecturalTelemetryBundle,
): CompatibleEvidence[] {
  return [
    ...bundle.repository.map((signal) => evidenceFromSignal(signal)),
    ...bundle.change.map((signal) => evidenceFromSignal(signal)),
    ...bundle.test.map((signal) => evidenceFromSignal(signal)),
    ...bundle.runtime.map((signal) => evidenceFromSignal(signal)),
    ...bundle.memory.map((signal) => evidenceFromSignal(signal)),
  ];
}

export const architecturalTelemetryNormalizer:
  ArchitecturalTelemetryNormalizer = {
    fromEvent: telemetryFromEvent,
    fromEvidence: telemetryFromEvidence,
    validate: validateTelemetryBundle,
  };

function addLifecycleSignal(
  bundle: ArchitecturalTelemetryBundle,
  event: CoachEventEnvelope,
  capturedAt: string,
  correlationId: string,
): void {
  bundle.lifecycle.push({
    id: makeId("lifecycle", event.host, event.event),
    family: "lifecycle",
    source: event.host,
    capturedAt,
    freshness: "current",
    confidence: "high",
    scope: "session",
    status: "present",
    correlationId,
    payload: {
      host: event.host,
      event: event.event,
      cwd: event.cwd,
      ...(event.userRequest ? { userRequest: event.userRequest } : {}),
      recentRequests: event.recentRequests,
    },
  });
}

function addRepositorySignalFromEvent(
  bundle: ArchitecturalTelemetryBundle,
  event: CoachEventEnvelope,
  capturedAt: string,
  correlationId: string,
): void {
  const status = normalizeStatus(event.repoSignals.status);
  const evidence = readEvidenceArray(event.repoSignals.evidence);
  if (status !== "present") {
    bundle.diagnostics.push({
      id: "diagnostic-repository-signals",
      severity: status === "failed" ? "warning" : "info",
      family: "repository",
      source: "repoSignals",
      message: `repository signal family is ${status}`,
    });
  }
  if (status === "absent" && evidence.length === 0) {
    return;
  }

  bundle.repository.push({
    id: makeId("repository", "repoSignals", event.cwd),
    family: "repository",
    source: "repoSignals",
    capturedAt,
    freshness: "current",
    confidence: status === "present" ? "medium" : "low",
    scope: "repo",
    status,
    correlationId,
    payload: {
      category: "repo_summary",
      repoRoot: event.cwd,
      evidence,
      details: event.repoSignals,
    },
  });
}

function addChangeSignalFromEvent(
  bundle: ArchitecturalTelemetryBundle,
  event: CoachEventEnvelope,
  capturedAt: string,
  correlationId: string,
): void {
  if (event.changedFiles.length === 0) {
    return;
  }

  bundle.change.push({
    id: makeId("change", "changedFiles", event.cwd),
    family: "change",
    source: "event.changedFiles",
    capturedAt,
    freshness: "current",
    confidence: "medium",
    scope: "change",
    status: "present",
    correlationId,
    relatedEventId: makeId("lifecycle", event.host, event.event),
    payload: {
      category: "changed_file_spread",
      changedFiles: event.changedFiles,
      evidence: event.changedFiles,
      diffSummary: readString(event, "diffSummary")
        ?? readString(event, "diff_summary"),
    },
  });
}

function addTestSignalFromSummary(
  bundle: ArchitecturalTelemetryBundle,
  testSummary: TestSummary,
  capturedAt: string,
  correlationId: string,
): void {
  const evidence = [
    testSummary.summary,
    testSummary.status ? `test status: ${testSummary.status}` : undefined,
  ].filter((value): value is string => typeof value === "string");

  bundle.test.push({
    id: makeId("test", "testSummary", testSummary.status ?? "unknown"),
    family: "test",
    source: "testSummary",
    capturedAt,
    freshness: "current",
    confidence: testSummary.status && testSummary.status !== "unknown"
      ? "medium"
      : "low",
    scope: "change",
    status: "present",
    correlationId,
    payload: {
      status: testSummary.status,
      category: "test_summary",
      evidence,
      summary: testSummary.summary,
    },
  });
}

function addMemorySignalFromDecision(
  bundle: ArchitecturalTelemetryBundle,
  decision: DecisionRecordSummary,
  index: number,
  capturedAt: string,
  correlationId: string,
): void {
  const revisitIf = Array.isArray(decision.revisitIf)
    ? decision.revisitIf.filter((item): item is string => typeof item === "string")
    : [];

  bundle.memory.push({
    id: makeId("memory", decision.id ?? `decision-${index}`, decision.concern ?? "unknown"),
    family: "memory",
    source: decision.id ?? "priorDecision",
    capturedAt,
    freshness: "current",
    confidence: decision.id ? "medium" : "low",
    scope: "concern",
    status: "present",
    correlationId,
    payload: {
      id: decision.id,
      concern: decision.concern,
      decision: decision.decision,
      revisitIf,
      evidence: [
        decision.decision,
        decision.concern ? `concern: ${decision.concern}` : undefined,
        revisitIf.length > 0 ? `revisit_if: ${revisitIf.join(", ")}` : undefined,
      ].filter((value): value is string => typeof value === "string"),
    },
  });
}

function addSignalFromOptionalEvidence(
  bundle: ArchitecturalTelemetryBundle,
  signal: CompatibleEvidence,
  index: number,
  capturedAt: string,
  correlationId: string,
): void {
  const category = typeof signal.category === "string" ? signal.category : "unknown";
  const family = familyForCategory(category);
  const source = typeof signal.source === "string" ? signal.source : `signal-${index}`;
  const status = normalizeStatus(signal.status);
  const freshness = normalizeFreshness(readString(signal, "freshness"));
  const confidence = normalizeConfidence(readString(signal, "confidence"));
  const evidence = Array.isArray(signal.evidence)
    ? signal.evidence.filter((item): item is string => typeof item === "string")
    : [];
  const id = makeId(family, source, category);

  if (status !== "present") {
    bundle.diagnostics.push({
      id: `diagnostic-${id}`,
      severity: status === "failed" ? "warning" : "info",
      family,
      source,
      message: readString(signal, "error")
        ? `${source} ${status}: ${readString(signal, "error")}`
        : `${source} ${category} signal is ${status}`,
    });
  }

  const envelopeBase = {
    id,
    family,
    source,
    capturedAt,
    freshness,
    confidence: status === "present" ? confidence : "low",
    scope: scopeForFamily(family),
    status,
    correlationId,
  } satisfies Omit<SignalEnvelope<unknown>, "payload">;

  switch (family) {
    case "repository":
      bundle.repository.push({
        ...envelopeBase,
        family,
        scope: "repo",
        payload: {
          category,
          repoRoot: "",
          evidence,
          details: detailsFromOptionalEvidence(signal),
        },
      });
      break;
    case "change":
      bundle.change.push({
        ...envelopeBase,
        family,
        scope: "change",
        payload: {
          category,
          changedFiles: [],
          evidence,
        },
      });
      break;
    case "test":
      bundle.test.push({
        ...envelopeBase,
        family,
        scope: "change",
        payload: {
          category,
          evidence,
        },
      });
      break;
    case "runtime":
      bundle.runtime.push({
        ...envelopeBase,
        family,
        scope: "runtime",
        payload: { category, evidence },
      });
      break;
  }
}

function validateSignalEnvelope(
  signal: SignalEnvelope<unknown>,
  field: string,
  expectedFamily: SignalFamily,
  issues: ProtocolValidationIssue[],
): void {
  if (!isRecord(signal)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  if (!nonEmptyString(signal.id)) {
    issues.push({ field: `${field}.id`, message: "must be a non-empty string" });
  }
  if (signal.family !== expectedFamily) {
    issues.push({ field: `${field}.family`, message: `must be ${expectedFamily}` });
  }
  if (!nonEmptyString(signal.source)) {
    issues.push({
      field: `${field}.source`,
      message: "must be a non-empty string",
    });
  }
  if (!nonEmptyString(signal.capturedAt)) {
    issues.push({
      field: `${field}.capturedAt`,
      message: "must be a non-empty string",
    });
  }
  if (!isFreshness(signal.freshness)) {
    issues.push({
      field: `${field}.freshness`,
      message: "must be current, stale, or unknown",
    });
  }
  if (!isConfidence(signal.confidence)) {
    issues.push({
      field: `${field}.confidence`,
      message: "must be low, medium, or high",
    });
  }
  if (!isScope(signal.scope)) {
    issues.push({
      field: `${field}.scope`,
      message: "must be session, repo, change, concern, or runtime",
    });
  }
  if (!isStatus(signal.status)) {
    issues.push({
      field: `${field}.status`,
      message: "must be present, absent, or failed",
    });
  }
  if (!("payload" in signal)) {
    issues.push({ field: `${field}.payload`, message: "is required" });
  }
}

function evidenceFromSignal(signal: SignalEnvelope<
  RepositorySignal | ChangeSignal | TestSignal | RuntimeSignal | MemorySignal
>): CompatibleEvidence {
  return {
    source: signal.source,
    status: signal.status,
    category: categoryFromSignal(signal),
    freshness: signal.freshness,
    confidence: signal.confidence,
    evidence: evidenceFromPayload(signal.payload),
  };
}

function evidenceFromPayload(
  payload: RepositorySignal | ChangeSignal | TestSignal | RuntimeSignal | MemorySignal,
): string[] {
  if ("evidence" in payload && Array.isArray(payload.evidence)) {
    return payload.evidence;
  }
  return [];
}

function categoryFromSignal(signal: SignalEnvelope<
  RepositorySignal | ChangeSignal | TestSignal | RuntimeSignal | MemorySignal
>): string {
  if ("category" in signal.payload && typeof signal.payload.category === "string") {
    return signal.payload.category;
  }
  if (signal.family === "memory") {
    return "prior_decision";
  }
  return signal.family;
}

function familyForCategory(category: string): Exclude<SignalFamily, "lifecycle" | "memory"> {
  switch (category) {
    case "file_layout":
    case "architecture_shape":
    case "architecture_claim":
    case "configuration_boundary":
    case "history_interaction":
      return "repository";
    case "changed_file_spread":
    case "import_relationship":
    case "symbol_reference":
      return "change";
    case "test_posture":
    case "diagnostic":
      return "test";
    case "runtime_error":
    case "monitor_event":
      return "runtime";
    default:
      return "repository";
  }
}

function scopeForFamily(family: SignalFamily): SignalScope {
  switch (family) {
    case "lifecycle":
      return "session";
    case "repository":
      return "repo";
    case "change":
    case "test":
      return "change";
    case "memory":
      return "concern";
    case "runtime":
      return "runtime";
  }
}

function deriveCorrelationId(event: CoachEventEnvelope | undefined): string {
  if (!event) {
    return "telemetry";
  }
  return makeId("correlation", event.host, event.event, event.cwd);
}

function makeId(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeStatus(value: unknown): TelemetrySignalStatus {
  return value === "present" || value === "failed" ? value : "absent";
}

function normalizeFreshness(value: string | undefined): TelemetryFreshness {
  return value === "current" || value === "stale" ? value : "unknown";
}

function normalizeConfidence(value: string | undefined): TelemetryConfidence {
  return value === "high" || value === "medium" ? value : "low";
}

function readEvidenceArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

function detailsFromOptionalEvidence(
  signal: CompatibleEvidence,
): Record<string, unknown> | undefined {
  if (!isRecord(signal)) {
    return undefined;
  }
  const details: Record<string, unknown> = {};
  if ("interactionGuidance" in signal) {
    details.interactionGuidance = signal.interactionGuidance;
  }
  if ("details" in signal && isRecord(signal.details)) {
    Object.assign(details, signal.details);
  }
  if ("facts" in signal && Array.isArray(signal.facts)) {
    details.facts = signal.facts;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFreshness(value: unknown): value is TelemetryFreshness {
  return value === "current" || value === "stale" || value === "unknown";
}

function isConfidence(value: unknown): value is TelemetryConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isScope(value: unknown): value is SignalScope {
  return (
    value === "session"
    || value === "repo"
    || value === "change"
    || value === "concern"
    || value === "runtime"
  );
}

function isStatus(value: unknown): value is SignalStatus {
  return value === "present" || value === "absent" || value === "failed";
}
