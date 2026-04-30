import type {
  CoachAction,
  CoachEventEnvelope,
} from "./protocol.js";
import type {
  ArchitecturalTelemetryBundle,
  MemorySignal,
  SignalEnvelope,
} from "./telemetryTypes.js";
import type { DecisionRecord } from "./memory.js";

export type RevisitCheckInput = {
  event: CoachEventEnvelope;
  records?: DecisionRecord[];
  telemetry?: ArchitecturalTelemetryBundle;
};

export type RevisitAlert = {
  decisionId: string;
  concern: string;
  decision: string;
  reason: string;
  risk: string[];
  matchedCondition: string;
  signalIds: string[];
  currentEvidence: string[];
  recommendedAction: CoachAction;
};

type RevisitCandidate = {
  decisionId: string;
  concern: string;
  decision: string;
  reason: string;
  risks: string[];
  revisitIf: string[];
};

type EvidenceItem = {
  signalId: string;
  text: string;
};

export function checkRevisit(input: RevisitCheckInput): RevisitAlert[] {
  const candidates = [
    ...(input.records ?? []).map(candidateFromRecord),
    ...memorySignals(input.telemetry).map(candidateFromMemorySignal),
  ];
  const evidence = collectCurrentEvidence(input.event, input.telemetry);
  const alerts: RevisitAlert[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.revisitIf.length === 0) {
      continue;
    }

    for (const condition of candidate.revisitIf) {
      const matches = evidence.filter((item) => conditionMatchesEvidence(condition, item.text));
      if (matches.length === 0) {
        continue;
      }

      const key = `${candidate.decisionId}:${condition}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      alerts.push({
        decisionId: candidate.decisionId,
        concern: candidate.concern,
        decision: candidate.decision,
        reason: candidate.reason,
        risk: candidate.risks,
        matchedCondition: condition,
        signalIds: Array.from(new Set(matches.map((item) => item.signalId))),
        currentEvidence: Array.from(new Set(matches.map((item) => item.text))).slice(0, 8),
        recommendedAction: recommendedActionFor(candidate.concern),
      });
    }
  }

  return alerts;
}

export function conditionMatchesEvidence(condition: string, evidence: string): boolean {
  const conditionText = normalizeText(condition);
  const evidenceText = normalizeText(evidence);
  if (conditionText.length === 0 || evidenceText.length === 0) {
    return false;
  }

  if (evidenceText.includes(conditionText)) {
    return true;
  }

  const tokens = meaningfulTokens(conditionText);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => evidenceText.includes(token))
    || tokens.some((token) => evidenceText.includes(token) && token.length >= 6);
}

export function collectCurrentEvidence(
  event: CoachEventEnvelope,
  telemetry?: ArchitecturalTelemetryBundle,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const eventText = [
    event.userRequest,
    ...event.recentRequests,
    ...event.changedFiles,
    ...(event.repoSignals.evidence ?? []),
    event.testSummary?.summary,
  ].filter((item): item is string => typeof item === "string");

  eventText.forEach((text, index) => {
    items.push({ signalId: `event-${index}`, text });
  });

  if (!telemetry) {
    return items;
  }

  for (const signal of [
    ...telemetry.lifecycle,
    ...telemetry.repository,
    ...telemetry.change,
    ...telemetry.test,
    ...telemetry.runtime,
  ]) {
    for (const text of evidenceFromSignal(signal)) {
      items.push({ signalId: signal.id, text });
    }
  }

  return items;
}

function memorySignals(
  telemetry: ArchitecturalTelemetryBundle | undefined,
): SignalEnvelope<MemorySignal>[] {
  return telemetry?.memory.filter((signal) => signal.status === "present") ?? [];
}

function candidateFromRecord(record: DecisionRecord): RevisitCandidate {
  return {
    decisionId: record.id,
    concern: record.concern,
    decision: record.decision,
    reason: record.reason,
    risks: record.risks,
    revisitIf: record.revisitIf,
  };
}

function candidateFromMemorySignal(
  signal: SignalEnvelope<MemorySignal>,
): RevisitCandidate {
  return {
    decisionId: signal.payload.id ?? signal.source,
    concern: signal.payload.concern ?? "unknown",
    decision: signal.payload.decision ?? "Unknown prior decision",
    reason: signal.payload.reason ?? "No reason was recorded in memory telemetry.",
    risks: signal.payload.risks ?? [],
    revisitIf: signal.payload.revisitIf,
  };
}

function evidenceFromSignal(signal: SignalEnvelope<unknown>): string[] {
  const payload = signal.payload;
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const evidence = "evidence" in payload ? payload.evidence : undefined;
  if (Array.isArray(evidence)) {
    return evidence.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function recommendedActionFor(concern: string): CoachAction {
  const normalized = concern.toLowerCase();
  if (containsAny(normalized, ["storage", "persistence", "database"])) {
    return "Replace substrate";
  }
  if (containsAny(normalized, ["auth", "security", "permission"])) {
    return "Run review";
  }
  if (containsAny(normalized, ["api", "contract", "public"])) {
    return "Stop and decide";
  }
  if (containsAny(normalized, ["state", "ownership", "boundary"])) {
    return "Assign ownership";
  }
  return "Record decision";
}

function meaningfulTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) =>
      !["when", "then", "with", "from", "this", "that", "user", "users"].includes(token)
    );
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
