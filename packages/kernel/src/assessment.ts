import { synthesizeArchitectureBaseline } from "./baseline.js";
import {
  type ArchitectureBaseline,
  type ArchitectureConcern,
  type BaselineQuestion,
  type ComplexityPressureLevel,
  type StructureAdequacyAssessment,
  type StructuralSupportLevel,
} from "./baselineTypes.js";
import { planBaselineInterviewQuestions } from "./baselineInterview.js";
import { claimsForTelemetry } from "./claims.js";
import type {
  ArchitectureClaim,
  ArchitectureEvidenceFact,
  EvidenceRole,
  EvidenceTimeframe,
} from "./claimTypes.js";
import {
  assertDecisionRecord,
  decisionRecordsToSummaries,
  type DecisionRecord,
} from "./memory.js";
import { normalizeHostEvent } from "./normalize.js";
import type {
  ArchitectureInteractionContext,
  CoachAction,
  CoachEventEnvelope,
  InterventionLevel,
  ProtocolValidationIssue,
} from "./protocol.js";
import { checkRevisit, type RevisitAlert } from "./revisit.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "./telemetry.js";
import { selectArchitecturePrinciples } from "./principles.js";
import {
  describeBoundaryContract,
  selectStructuralPatterns,
} from "./patterns.js";
import type { PrincipleGuidance } from "./principleTypes.js";
import {
  selectArchitecturePolicy,
  type ArchitecturePolicyDecision,
} from "./policy.js";
import {
  debtAssessmentFor,
  type ArchitectureDebtAssessment,
} from "./complexity.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalEnvelope,
} from "./telemetryTypes.js";

export type AssessmentEvidence = {
  family?: string;
  source: string;
  category?: string;
  summary: string;
  signalId?: string;
  timeframe?: EvidenceTimeframe;
  role?: EvidenceRole;
};

export type TemporalBrief = {
  past: string[];
  current: string[];
  future: string[];
  uncertain: string[];
};

export type AssessmentResult = {
  status: "ok" | "needs_attention";
  intervention: InterventionLevel;
  action: CoachAction;
  reason: string;
  evidence: AssessmentEvidence[];
  doNotAdd: string[];
  memory: {
    status: "not_checked" | "absent" | "loaded";
    decisionCount: number;
  };
  baseline: ArchitectureBaseline;
  questions: BaselineQuestion[];
  claims?: ArchitectureClaim[];
  revisitAlerts: RevisitAlert[];
  principleGuidance: PrincipleGuidance[];
  policy?: ArchitecturePolicyDecision;
  temporalBrief?: TemporalBrief;
  structureReasoning?: StructureAdequacyAssessment[];
  architectureDebt?: ArchitectureDebtAssessment[];
  interactionContext?: ArchitectureInteractionContext;
};

export type AssessmentInput = {
  event?: CoachEventEnvelope | Record<string, unknown>;
  telemetry?: ArchitecturalTelemetryBundle;
  memoryRecords?: DecisionRecord[];
};

export type NormalizedAssessmentInput = {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  memoryRecords: DecisionRecord[];
};

export class AssessmentValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "AssessmentValidationError";
    this.issues = issues;
  }
}

export function assessArchitecture(input: AssessmentInput): AssessmentResult {
  const normalized = normalizeAssessmentInput(input);
  const priorDecisions = decisionRecordsToSummaries(normalized.memoryRecords);
  const event = {
    ...normalized.event,
    priorDecisions: [
      ...normalized.event.priorDecisions,
      ...priorDecisions.filter(
        (record) =>
          !normalized.event.priorDecisions.some((existing) => existing.id === record.id),
      ),
    ],
    memoryRefs: Array.from(new Set([
      ...normalized.event.memoryRefs,
      ...normalized.memoryRecords.map((record) => record.id),
    ])),
  };

  const baseline = synthesizeArchitectureBaseline({
    event,
    telemetry: normalized.telemetry,
    priorDecisions: event.priorDecisions,
  });
  const claims = claimsForTelemetry(normalized.telemetry);
  const interactionContext = classifyInteractionContext(event);
  const questions = planBaselineInterviewQuestions({
    baseline,
    telemetry: normalized.telemetry,
    claims,
    interactionContext,
  });
  const structureReasoning = baseline.concerns
    .map((concern) => concern.adequacy)
    .filter((adequacy): adequacy is StructureAdequacyAssessment => Boolean(adequacy));
  const revisitAlerts = checkRevisit({
    event,
    records: normalized.memoryRecords,
    telemetry: normalized.telemetry,
    structureReasoning,
  });
  const principleGuidance = buildPrincipleGuidance(baseline);
  const temporalBrief = buildTemporalBrief(normalized.telemetry);
  const policy = selectArchitecturePolicy({
    baseline,
    questions,
    revisitAlerts,
    principleGuidance,
    interactionContext,
    temporalBrief,
  });
  const architectureDebt = buildArchitectureDebt(structureReasoning, normalized.memoryRecords);

  return {
    status: policy.selected.intervention === "silent" || policy.selected.action === "Continue"
      ? "ok"
      : "needs_attention",
    intervention: policy.selected.intervention,
    action: policy.selected.action,
    reason: policy.selected.reason,
    evidence: buildEvidence(normalized.telemetry, baseline, revisitAlerts, structureReasoning),
    doNotAdd: doNotAddGuidance(baseline, policy.selected),
    memory: {
      status: normalized.memoryRecords.length > 0 ? "loaded" : "absent",
      decisionCount: normalized.memoryRecords.length,
    },
    baseline,
    questions,
    claims,
    revisitAlerts,
    principleGuidance,
    policy,
    temporalBrief,
    structureReasoning,
    architectureDebt,
    interactionContext,
  };
}

export function classifyInteractionContext(
  event: CoachEventEnvelope,
): ArchitectureInteractionContext {
  if (event.interactionContext) {
    return event.interactionContext;
  }

  const text = [
    event.event,
    event.userRequest,
    ...event.recentRequests,
  ].filter(Boolean).join("\n").toLowerCase();

  if (containsAny(text, [
    "capture baseline",
    "first repository baseline",
    "repository baseline",
    "baseline capture",
    "assess this repository",
    "assess repository",
    "review current repo",
    "review current repository",
  ]) && !containsAny(text, activeIntentTerms)) {
    return "passive_baseline";
  }
  if (containsAny(text, ["deploy", "release", "hosting", "production", "staging", "rollback"])) {
    return "deployment_planning";
  }
  if (containsAny(text, ["risk review", "security review", "security risk", "risk", "audit", "threat", "compliance", "gdpr"])) {
    return "risk_review";
  }
  if (containsAny(text, ["decide", "decision", "choose", "tradeoff", "adr", "record decision"])) {
    return "architecture_decision";
  }
  if (containsAny(text, ["recommend", "next move", "what should", "what's next", "what next", "where to start"])) {
    return "requested_next_action";
  }
  if (
    event.changedFiles.length > 0
    || containsAny(text, ["change", "diff", "pr", "pull request", "implement", "add ", "create ", "refactor", "fix "])
  ) {
    return "pending_change_assessment";
  }
  return "passive_baseline";
}

const activeIntentTerms = [
  "recommend",
  "next move",
  "what should",
  "what's next",
  "what next",
  "where to start",
  "implement",
  "add ",
  "create ",
  "refactor",
  "fix ",
  "deploy",
  "release",
  "risk",
  "security review",
  "test harness",
  "decide",
  "decision",
];

export function normalizeAssessmentInput(
  input: AssessmentInput | ArchitecturalTelemetryBundle | Record<string, unknown>,
): NormalizedAssessmentInput {
  if (isTelemetryBundle(input)) {
    const telemetry = assertValidTelemetryBundle(input);
    const raw = input as ArchitecturalTelemetryBundle & { memoryRecords?: unknown };
    const memoryRecords = readDecisionRecords(raw.memoryRecords);
    return {
      event: eventFromTelemetry(telemetry),
      telemetry,
      memoryRecords,
    };
  }

  if (!isRecord(input)) {
    throw new AssessmentValidationError([
      { field: "$", message: "assessment input must be an object" },
    ]);
  }

  const memoryRecords = readDecisionRecords(input.memoryRecords);

  if (isTelemetryBundle(input.telemetry)) {
    const telemetry = assertValidTelemetryBundle(input.telemetry);
    return {
      event: isRecord(input.event)
        ? normalizeHostEvent(input.event)
        : eventFromTelemetry(telemetry),
      telemetry,
      memoryRecords,
    };
  }

  const event = normalizeHostEvent(
    isRecord(input.event) ? input.event : input,
  );
  return {
    event,
    telemetry: telemetryFromEvent(event),
    memoryRecords,
  };
}

function buildPrincipleGuidance(
  baseline: ArchitectureBaseline,
): PrincipleGuidance[] {
  return baseline.concerns
    .map((concern): PrincipleGuidance | undefined => {
      if (concern.facts.length === 0) {
        return undefined;
      }
      const principles = selectArchitecturePrinciples({
        concern,
        facts: baseline.facts,
      });
      const patterns = selectStructuralPatterns({
        concern,
        principles,
        facts: baseline.facts,
      });
      if (principles.length === 0 && patterns.length === 0) {
        return undefined;
      }
      const contract = patterns[0]
        ? describeBoundaryContract({ pattern: patterns[0], concern })
        : undefined;
      return {
        concern: concern.concern,
        principles,
        patterns,
        ...(contract ? { contract } : {}),
      };
    })
    .filter((guidance): guidance is PrincipleGuidance => Boolean(guidance));
}

function doNotAddGuidance(
  baseline: ArchitectureBaseline,
  selected: ArchitecturePolicyDecision["selected"],
): string[] {
  if (selected.doNotAdd.length > 0) {
    return selected.doNotAdd;
  }
  if (baseline.facts.length === 0) {
    return ["Do not add durable architecture structure until there is concrete project evidence."];
  }
  if (selected.action === "Continue") {
    return ["Do not introduce new boundaries, storage, auth, or deployment machinery without a matching threshold signal."];
  }
  return [];
}

function buildEvidence(
  telemetry: ArchitecturalTelemetryBundle,
  baseline: ArchitectureBaseline,
  alerts: RevisitAlert[],
  structureReasoning: StructureAdequacyAssessment[],
): AssessmentEvidence[] {
  const evidence: AssessmentEvidence[] = [];
  for (const alert of alerts) {
    evidence.push({
      family: "memory",
      source: alert.decisionId,
      summary: `matched ${alert.matchedCondition}: ${alert.currentEvidence.join("; ")}`,
    });
  }

  for (const signal of allSignals(telemetry).slice(0, 8)) {
    evidence.push(evidenceFromSignal(signal));
  }

  for (const fact of baseline.facts.slice(0, 6)) {
    evidence.push({
      source: fact.id,
      category: fact.concern,
      summary: fact.summary,
    });
  }

  for (const adequacy of visibleAdequacyEvidence(structureReasoning)) {
    evidence.push({
      family: "complexity",
      source: `adequacy-${adequacy.concern}`,
      category: adequacy.concern,
      summary: `${adequacy.status}: ${adequacy.reason} Next action: ${adequacy.nextAction}.`,
    });
  }

  return dedupeEvidence(evidence).slice(0, 12);
}

function visibleAdequacyEvidence(
  structureReasoning: StructureAdequacyAssessment[],
): StructureAdequacyAssessment[] {
  return structureReasoning
    .filter((item) =>
      item.status === "under_structured"
      || item.status === "over_structured"
      || item.status === "watch"
    )
    .slice(0, 4);
}

function buildArchitectureDebt(
  adequacy: StructureAdequacyAssessment[],
  records: DecisionRecord[],
): ArchitectureDebtAssessment[] {
  const results: ArchitectureDebtAssessment[] = [];
  const acceptedRecords = records.filter((record) => record.kind === "accepted_debt");
  for (const item of adequacy) {
    if (item.status !== "under_structured") {
      continue;
    }
    const accepted = acceptedRecords.find((record) =>
      record.adviceStatus === "active"
      && concernMatches(record.concern, item.concern)
      && record.revisitIf.length > 0
    );
    const reopened = acceptedRecords.find((record) =>
      record.adviceStatus === "handled"
      && concernMatches(record.concern, item.concern)
      && adequacyOutgrew(record, item)
    );
    results.push(debtAssessmentFor({
      adequacy: item,
      accepted: Boolean(accepted ?? reopened),
      status: reopened ? "reopened" : undefined,
      rationale: (accepted ?? reopened)?.reason,
      acceptedRisk: (accepted ?? reopened)?.acceptedRisk,
      revisitIf: (accepted ?? reopened)?.revisitIf,
    }));
  }
  for (const record of acceptedRecords) {
    const current = adequacy.find((item) => concernMatches(record.concern, item.concern));
    if (current && current.status !== "under_structured") {
      results.push(debtAssessmentFor({
        adequacy: current,
        accepted: true,
        stale: true,
        rationale: record.reason,
        acceptedRisk: record.acceptedRisk,
        revisitIf: record.revisitIf,
      }));
    }
  }
  return results;
}

function adequacyOutgrew(
  record: DecisionRecord,
  adequacy: StructureAdequacyAssessment,
): boolean {
  if (!record.pressure || !record.support) {
    return false;
  }
  return pressureRankFor(adequacy.pressure) > pressureRankFor(record.pressure)
    || supportRankFor(adequacy.support) < supportRankFor(record.support);
}

function readDecisionRecords(value: unknown): DecisionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((record) => assertDecisionRecord(record));
}

function evidenceFromSignal(signal: SignalEnvelope<unknown>): AssessmentEvidence {
  const payload = signal.payload;
  const category = readPayloadString(payload, "category");
  const payloadEvidence = readPayloadEvidence(payload);
  const temporal = preferredTemporalEvidence(payload);
  return {
    family: signal.family,
    source: signal.source,
    ...(category ? { category } : {}),
    signalId: signal.id,
    summary: temporal?.summary ?? payloadEvidence[0] ?? `${signal.family} signal from ${signal.source}`,
    ...(temporal?.timeframe ? { timeframe: temporal.timeframe } : {}),
    ...(temporal?.role ? { role: temporal.role } : {}),
  };
}

function buildTemporalBrief(telemetry: ArchitecturalTelemetryBundle): TemporalBrief {
  const brief: TemporalBrief = { past: [], current: [], future: [], uncertain: [] };
  for (const signal of allSignals(telemetry)) {
    for (const item of temporalEvidenceFromPayload(signal.payload)) {
      brief[item.timeframe].push(formatTemporalItem(item));
    }
  }
  return {
    past: uniqueFirst(brief.past, 4),
    current: uniqueFirst(brief.current, 4),
    future: uniqueFirst(brief.future, 4),
    uncertain: uniqueFirst(brief.uncertain, 4),
  };
}

function preferredTemporalEvidence(
  payload: unknown,
): TemporalEvidenceItem | undefined {
  const items = temporalEvidenceFromPayload(payload);
  return items.sort((left, right) =>
    temporalPriority(right) - temporalPriority(left)
  )[0];
}

type TemporalEvidenceItem = {
  path?: string;
  timeframe: EvidenceTimeframe;
  role: EvidenceRole;
  summary: string;
};

function temporalEvidenceFromPayload(payload: unknown): TemporalEvidenceItem[] {
  if (!isRecord(payload)) {
    return [];
  }
  const details = isRecord(payload.details) ? payload.details : undefined;
  const explicit = Array.isArray(details?.temporalEvidence)
    ? details.temporalEvidence.filter(isTemporalEvidenceItem)
    : [];
  const facts = Array.isArray(details?.facts)
    ? details.facts.filter(isArchitectureFact).flatMap((fact) =>
      fact.provenance.map((item) => ({
        path: item.path,
        timeframe: fact.timeframe ?? "uncertain",
        role: fact.role ?? "repository_shape",
        summary: fact.summary,
      }))
    )
    : [];
  return [...explicit, ...facts];
}

function isTemporalEvidenceItem(value: unknown): value is TemporalEvidenceItem {
  return isRecord(value)
    && isTimeframe(value.timeframe)
    && isRole(value.role)
    && typeof value.summary === "string";
}

function isArchitectureFact(value: unknown): value is ArchitectureEvidenceFact {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.summary === "string"
    && Array.isArray(value.provenance);
}

function isTimeframe(value: unknown): value is EvidenceTimeframe {
  return value === "past" || value === "current" || value === "future" || value === "uncertain";
}

function isRole(value: unknown): value is EvidenceRole {
  return value === "architecture_basis"
    || value === "implementation"
    || value === "experiment"
    || value === "decision_record"
    || value === "test_evidence"
    || value === "work_in_progress"
    || value === "repository_shape";
}

function temporalPriority(item: TemporalEvidenceItem): number {
  if (item.timeframe === "future" && item.role === "architecture_basis") return 100;
  if (item.timeframe === "current" && item.role === "implementation") return 90;
  if (item.timeframe === "current" && item.role === "test_evidence") return 80;
  if (item.timeframe === "current") return 70;
  if (item.timeframe === "uncertain") return 40;
  return 20;
}

function formatTemporalItem(item: TemporalEvidenceItem): string {
  const location = item.path ? `${item.path}: ` : "";
  return `${location}${item.summary}`;
}

function uniqueFirst(items: string[], limit: number): string[] {
  return Array.from(new Set(items)).slice(0, limit);
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (isRecord(payload) && typeof payload[key] === "string") {
    return payload[key];
  }
  return undefined;
}

function readPayloadEvidence(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.evidence)) {
    return [];
  }
  return payload.evidence.filter((item): item is string => typeof item === "string");
}

function dedupeEvidence(evidence: AssessmentEvidence[]): AssessmentEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.family ?? ""}:${item.source}:${item.category ?? ""}:${item.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function allSignals(telemetry: ArchitecturalTelemetryBundle): SignalEnvelope<unknown>[] {
  return [
    ...telemetry.lifecycle,
    ...telemetry.repository,
    ...telemetry.change,
    ...telemetry.test,
    ...telemetry.memory,
    ...telemetry.runtime,
  ];
}

function eventFromTelemetry(telemetry: ArchitecturalTelemetryBundle): CoachEventEnvelope {
  const lifecycle = telemetry.lifecycle[0];
  if (!lifecycle) {
    throw new AssessmentValidationError([
      { field: "telemetry.lifecycle", message: "must contain at least one lifecycle signal" },
    ]);
  }
  return {
    host: lifecycle.payload.host,
    event: lifecycle.payload.event,
    cwd: lifecycle.payload.cwd,
    ...(lifecycle.payload.userRequest ? { userRequest: lifecycle.payload.userRequest } : {}),
    recentRequests: lifecycle.payload.recentRequests,
    changedFiles: Array.from(new Set(telemetry.change.flatMap((signal) => signal.payload.changedFiles))),
    repoSignals: {
      status: telemetry.repository.some((signal) => signal.status === "present")
        ? "present"
        : "absent",
      evidence: telemetry.repository.flatMap((signal) => signal.payload.evidence),
    },
    memoryRefs: telemetry.memory
      .map((signal) => signal.payload.id ?? signal.source)
      .filter((value): value is string => typeof value === "string"),
    priorDecisions: telemetry.memory.map((signal) => ({
      id: signal.payload.id,
      concern: signal.payload.concern,
      decision: signal.payload.decision,
      revisitIf: signal.payload.revisitIf,
    })),
    optionalSignals: [],
  };
}

function isTelemetryBundle(value: unknown): value is ArchitecturalTelemetryBundle {
  return isRecord(value)
    && Array.isArray(value.lifecycle)
    && Array.isArray(value.repository)
    && Array.isArray(value.change)
    && Array.isArray(value.test)
    && Array.isArray(value.memory)
    && Array.isArray(value.runtime)
    && Array.isArray(value.diagnostics);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function concernMatches(recordConcern: string, concern: ArchitectureConcern): boolean {
  const normalized = recordConcern.toLowerCase();
  switch (concern) {
    case "data_storage":
      return containsAny(normalized, ["storage", "persistence", "database"]);
    case "state_ownership":
      return containsAny(normalized, ["state", "ownership"]);
    case "authentication":
      return containsAny(normalized, ["auth", "identity", "login", "session"]);
    case "authorization":
      return containsAny(normalized, ["authorization", "permission", "role", "access"]);
    case "api_contract":
      return containsAny(normalized, ["api", "contract"]);
    case "deployment":
      return containsAny(normalized, ["deploy", "hosting", "production"]);
    default:
      return normalized.includes(concern);
  }
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function pressureRankFor(level: ComplexityPressureLevel): number {
  switch (level) {
    case "none":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function supportRankFor(level: StructuralSupportLevel): number {
  switch (level) {
    case "absent":
      return 0;
    case "localized":
      return 1;
    case "named":
      return 2;
    case "bounded":
      return 3;
    case "contracted":
      return 4;
    case "operationalized":
      return 5;
    case "unknown":
      return -1;
  }
}
