export type UsageEventSource = "skill" | "hook" | "mcp" | "evaluation" | "system";

export type UsageEngagementType =
  | "baseline_capture"
  | "graph_query"
  | "followup_injection"
  | "passive_silence"
  | "response_evaluation"
  | "error"
  | "user_visible_advice";

export type UsageOutcome = "engaged" | "quiet" | "failed" | "skipped";

export type UsageMetadataValue = string | number | boolean;

export type UsageEventInput = {
  id?: string;
  occurredAt?: string;
  repoId?: string;
  repoRoot: string;
  sessionId?: string;
  source: UsageEventSource;
  engagementType: UsageEngagementType;
  outcome: UsageOutcome;
  metadata?: Record<string, unknown>;
};

export type UsageEvent = {
  id: string;
  occurredAt: string;
  repoId: string;
  repoRoot: string;
  source: UsageEventSource;
  engagementType: UsageEngagementType;
  outcome: UsageOutcome;
  metadata: Record<string, UsageMetadataValue>;
  sessionId?: string;
};

export type UsageClassificationInput = {
  source: UsageEventSource;
  toolName?: string;
  hookEffect?: "none" | "inject" | "block";
  architectureRelevant?: boolean;
  baselineExists?: boolean;
  responseFailed?: boolean;
  error?: boolean;
};

export type UsageReviewInput = {
  repoId?: string;
  repoRoot?: string;
  sessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
};

export type UsageReview = {
  summary: {
    totalEvents: number;
    byRepository: Record<string, number>;
    bySource: Record<UsageEventSource, number>;
    byEngagementType: Record<UsageEngagementType, number>;
    byOutcome: Record<UsageOutcome, number>;
  };
  events: UsageEvent[];
  notableGaps: UsageEvent[];
  page: {
    limit: number;
    nextCursor?: string;
  };
  emptyState?: string;
};

const sources: UsageEventSource[] = ["skill", "hook", "mcp", "evaluation", "system"];
const engagementTypes: UsageEngagementType[] = [
  "baseline_capture",
  "graph_query",
  "followup_injection",
  "passive_silence",
  "response_evaluation",
  "error",
  "user_visible_advice",
];
const outcomes: UsageOutcome[] = ["engaged", "quiet", "failed", "skipped"];

export function normalizeUsageEvent(input: UsageEventInput, now = new Date().toISOString()): UsageEvent {
  if (!input.repoRoot || input.repoRoot.trim().length === 0) {
    throw new UsageEventValidationError("repoRoot is required");
  }
  if (!sources.includes(input.source)) {
    throw new UsageEventValidationError(`unsupported source ${input.source}`);
  }
  if (!engagementTypes.includes(input.engagementType)) {
    throw new UsageEventValidationError(`unsupported engagement type ${input.engagementType}`);
  }
  if (!outcomes.includes(input.outcome)) {
    throw new UsageEventValidationError(`unsupported outcome ${input.outcome}`);
  }

  const occurredAt = input.occurredAt ?? now;
  return {
    id: input.id ?? usageEventId(input.source, input.engagementType, occurredAt),
    occurredAt,
    repoId: input.repoId ?? input.repoRoot,
    repoRoot: input.repoRoot,
    source: input.source,
    engagementType: input.engagementType,
    outcome: input.outcome,
    metadata: sanitizeUsageMetadata(input.metadata ?? {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

export function classifyUsageEvent(input: UsageClassificationInput): {
  engagementType: UsageEngagementType;
  outcome: UsageOutcome;
  metadata: Record<string, UsageMetadataValue>;
} {
  if (input.error) {
    return {
      engagementType: "error",
      outcome: "failed",
      metadata: { reason: "error" },
    };
  }

  if (input.source === "hook") {
    if (input.hookEffect === "inject" || input.hookEffect === "block") {
      return {
        engagementType: "followup_injection",
        outcome: "engaged",
        metadata: { hookEffect: input.hookEffect },
      };
    }
    const missedEngagementCandidate = Boolean(input.architectureRelevant && input.baselineExists);
    return {
      engagementType: "passive_silence",
      outcome: "quiet",
      metadata: {
        architectureRelevant: Boolean(input.architectureRelevant),
        baselineExists: Boolean(input.baselineExists),
        missedEngagementCandidate,
      },
    };
  }

  if (input.source === "mcp") {
    if (input.toolName === "architecture.capture_assessment") {
      return {
        engagementType: "baseline_capture",
        outcome: "engaged",
        metadata: { toolName: input.toolName },
      };
    }
    if (
      input.toolName === "architecture.query_assessment_graph"
      || input.toolName === "architecture.get_assessment_node"
    ) {
      return {
        engagementType: "graph_query",
        outcome: "engaged",
        metadata: { toolName: input.toolName },
      };
    }
    if (input.toolName === "architecture.review_usage") {
      return {
        engagementType: "user_visible_advice",
        outcome: "engaged",
        metadata: { toolName: input.toolName },
      };
    }
    return {
      engagementType: "user_visible_advice",
      outcome: "engaged",
      metadata: { toolName: input.toolName ?? "unknown" },
    };
  }

  if (input.source === "evaluation") {
    return {
      engagementType: "response_evaluation",
      outcome: input.responseFailed ? "failed" : "engaged",
      metadata: { responseFailed: Boolean(input.responseFailed) },
    };
  }

  return {
    engagementType: "user_visible_advice",
    outcome: "skipped",
    metadata: { reason: "unclassified" },
  };
}

export function sanitizeUsageMetadata(metadata: Record<string, unknown>): Record<string, UsageMetadataValue> {
  const safe: Record<string, UsageMetadataValue> = {};
  let redacted = false;

  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const key = sanitizeKey(rawKey);
    if (!key) {
      redacted = true;
      continue;
    }
    const value = sanitizeMetadataValue(rawKey, rawValue);
    if (value === undefined) {
      redacted = true;
      continue;
    }
    safe[key] = value;
  }

  if (redacted) {
    safe.redacted = true;
  }
  return safe;
}

export function buildUsageReview(events: UsageEvent[], input: UsageReviewInput = {}): UsageReview {
  const filtered = events
    .filter((event) => !input.repoId || event.repoId === input.repoId)
    .filter((event) => !input.repoRoot || event.repoRoot === input.repoRoot)
    .filter((event) => !input.sessionId || event.sessionId === input.sessionId)
    .filter((event) => !input.since || event.occurredAt >= input.since)
    .filter((event) => !input.until || event.occurredAt <= input.until)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  const offset = parseCursor(input.cursor);
  const limit = boundedLimit(input.limit);
  const pageEvents = filtered.slice(offset, offset + limit);
  const nextCursor = offset + limit < filtered.length ? `offset:${offset + limit}` : undefined;

  return {
    summary: {
      totalEvents: filtered.length,
      byRepository: countBy(filtered, (event) => event.repoId),
      bySource: countByKnown(filtered, sources, (event) => event.source),
      byEngagementType: countByKnown(filtered, engagementTypes, (event) => event.engagementType),
      byOutcome: countByKnown(filtered, outcomes, (event) => event.outcome),
    },
    events: pageEvents,
    notableGaps: filtered.filter(isMissedEngagementCandidate).slice(0, 20),
    page: {
      limit,
      ...(nextCursor ? { nextCursor } : {}),
    },
    ...(filtered.length === 0
      ? { emptyState: "No Tech Lead usage events have been recorded for this query." }
      : {}),
  };
}

export function isMissedEngagementCandidate(event: UsageEvent): boolean {
  return event.engagementType === "passive_silence"
    && event.outcome === "quiet"
    && event.metadata.missedEngagementCandidate === true;
}

export class UsageEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageEventValidationError";
  }
}

function usageEventId(source: UsageEventSource, engagementType: UsageEngagementType, occurredAt: string): string {
  return `usage-${source}-${engagementType}-${occurredAt.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function sanitizeKey(key: string): string | undefined {
  const normalized = key.trim().replace(/[^a-zA-Z0-9_:-]+/g, "_").slice(0, 64);
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeMetadataValue(key: string, value: unknown): UsageMetadataValue | undefined {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const lowerKey = key.toLowerCase();
  const lowerValue = value.toLowerCase();
  if (
    containsSensitiveKey(lowerKey)
    || looksSecret(lowerValue)
    || looksLikeRawPromptOrSource(value)
  ) {
    return undefined;
  }
  return value.slice(0, 120);
}

function containsSensitiveKey(key: string): boolean {
  return [
    "prompt",
    "response",
    "source",
    "code",
    "content",
    "secret",
    "token",
    "password",
    "api_key",
    "apikey",
    "authorization",
    "env",
  ].some((part) => key.includes(part));
}

function looksSecret(value: string): boolean {
  return /\b(bearer|authorization|api[_-]?key|token|password|secret)\b/.test(value)
    || /\bsk-[a-z0-9_-]{12,}\b/.test(value)
    || /[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}/.test(value);
}

function looksLikeRawPromptOrSource(value: string): boolean {
  return value.length > 160
    || value.includes("\n")
    || /\b(import|export|function|const|let|class|interface)\b.*[{};]/s.test(value);
}

function countBy<T>(events: UsageEvent[], keyFor: (event: UsageEvent) => T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = String(keyFor(event));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countByKnown<T extends string>(
  events: UsageEvent[],
  keys: T[],
  keyFor: (event: UsageEvent) => T,
): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const event of events) {
    counts[keyFor(event)] += 1;
  }
  return counts;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const match = /^offset:(\d+)$/.exec(cursor);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return 50;
  }
  return Math.min(limit, 200);
}
