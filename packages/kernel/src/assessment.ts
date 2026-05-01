import { synthesizeArchitectureBaseline } from "./baseline.js";
import {
  type ArchitectureBaseline,
  type ArchitectureConcern,
  type BaselineQuestion,
} from "./baselineTypes.js";
import { planBaselineInterviewQuestions } from "./baselineInterview.js";
import {
  decisionRecordsToSummaries,
  type DecisionRecord,
} from "./memory.js";
import { normalizeHostEvent } from "./normalize.js";
import type {
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
  revisitAlerts: RevisitAlert[];
  principleGuidance: PrincipleGuidance[];
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
  const questions = planBaselineInterviewQuestions({
    baseline,
    telemetry: normalized.telemetry,
  });
  const revisitAlerts = checkRevisit({
    event,
    records: normalized.memoryRecords,
    telemetry: normalized.telemetry,
  });
  const principleGuidance = buildPrincipleGuidance(baseline);

  const recommendation = chooseRecommendation(baseline, questions, revisitAlerts);
  return {
    status: recommendation.intervention === "silent" || recommendation.action === "Continue"
      ? "ok"
      : "needs_attention",
    intervention: recommendation.intervention,
    action: recommendation.action,
    reason: recommendation.reason,
    evidence: buildEvidence(normalized.telemetry, baseline, revisitAlerts),
    doNotAdd: doNotAddGuidance(baseline, recommendation.action),
    memory: {
      status: normalized.memoryRecords.length > 0 ? "loaded" : "absent",
      decisionCount: normalized.memoryRecords.length,
    },
    baseline,
    questions,
    revisitAlerts,
    principleGuidance,
  };
}

export function normalizeAssessmentInput(
  input: AssessmentInput | ArchitecturalTelemetryBundle | Record<string, unknown>,
): NormalizedAssessmentInput {
  if (isTelemetryBundle(input)) {
    const telemetry = assertValidTelemetryBundle(input);
    const raw = input as ArchitecturalTelemetryBundle & { memoryRecords?: unknown };
    const memoryRecords = Array.isArray(raw.memoryRecords)
      ? raw.memoryRecords.filter((record): record is DecisionRecord => isRecord(record))
      : [];
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

  const memoryRecords = Array.isArray(input.memoryRecords)
    ? input.memoryRecords.filter((record): record is DecisionRecord => isRecord(record))
    : [];

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

function chooseRecommendation(
  baseline: ArchitectureBaseline,
  questions: BaselineQuestion[],
  alerts: RevisitAlert[],
): {
  intervention: InterventionLevel;
  action: CoachAction;
  reason: string;
} {
  if (alerts.length > 0) {
    const alert = alerts[0];
    return {
      intervention: "recommend",
      action: alert.recommendedAction,
      reason: `Prior decision ${alert.decisionId} matched revisit condition "${alert.matchedCondition}".`,
    };
  }

  const packageBoundary = baseline.concerns.find(
    (concern) =>
      concern.concern === "package_boundary"
      && concern.facts.length > 0
      && concern.confidence !== "low",
  );
  if (packageBoundary) {
    return {
      intervention: "recommend",
      action: "Add test harness",
      reason: "Repository shape shows a runtime or package boundary that can be protected locally while open assumptions remain visible.",
    };
  }

  if (questions.length > 0) {
    return {
      intervention: "recommend",
      action: "Record decision",
      reason: `Baseline has ${questions.length} high-impact unconfirmed assumption${questions.length === 1 ? "" : "s"}.`,
    };
  }

  const risk = baseline.concerns.find(
    (concern) =>
      concern.concern === "risk_hotspot"
      && concern.thresholdCandidates.includes("blast_radius"),
  );
  if (risk) {
    return {
      intervention: "recommend",
      action: "Run review",
      reason: "Current evidence shows broad change or risk hotspot pressure.",
    };
  }

  const loadBearing = baseline.concerns.find(
    (concern) =>
      concern.currentState === "LoadBearing" || concern.currentState === "Revisit",
  );
  if (loadBearing) {
    return {
      intervention: "recommend",
      action: actionForConcern(loadBearing.concern),
      reason: `${loadBearing.concern} appears ${loadBearing.currentState}.`,
    };
  }

  if (baseline.facts.length === 0) {
    return {
      intervention: "note",
      action: "Continue",
      reason: "No concrete architecture evidence or prior decisions were available.",
    };
  }

  return {
    intervention: "note",
    action: "Continue",
    reason: "Current evidence does not require adding structure yet.",
  };
}

function actionForConcern(concern: ArchitectureConcern): CoachAction {
  switch (concern) {
    case "data_storage":
      return "Replace substrate";
    case "authentication":
    case "authorization":
      return "Run review";
    case "state_ownership":
      return "Assign ownership";
    case "package_boundary":
    case "api_contract":
      return "Insert boundary";
    case "testing":
      return "Add test harness";
    case "observability":
      return "Operationalize";
    default:
      return "Record decision";
  }
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
  action: CoachAction,
): string[] {
  if (baseline.facts.length === 0) {
    return ["Do not add durable architecture structure until there is concrete project evidence."];
  }
  if (action === "Continue") {
    return ["Do not introduce new boundaries, storage, auth, or deployment machinery without a matching threshold signal."];
  }
  return [];
}

function buildEvidence(
  telemetry: ArchitecturalTelemetryBundle,
  baseline: ArchitectureBaseline,
  alerts: RevisitAlert[],
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

  return dedupeEvidence(evidence).slice(0, 12);
}

function evidenceFromSignal(signal: SignalEnvelope<unknown>): AssessmentEvidence {
  const payload = signal.payload;
  const category = readPayloadString(payload, "category");
  const payloadEvidence = readPayloadEvidence(payload);
  return {
    family: signal.family,
    source: signal.source,
    ...(category ? { category } : {}),
    signalId: signal.id,
    summary: payloadEvidence[0] ?? `${signal.family} signal from ${signal.source}`,
  };
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
