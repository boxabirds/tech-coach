import type { AssessmentResult } from "./assessment.js";
import type { CoachAction } from "./protocol.js";
import type {
  ArchitectureConcern,
  BaselineQuestion,
} from "./baselineTypes.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalEnvelope,
  SignalFamily,
} from "./telemetryTypes.js";

export type SpecialistConcern =
  | "security"
  | "persistence"
  | "deployment"
  | "api_contract"
  | "architecture_spread";

export type ReviewFinding = {
  severity: "info" | "warning" | "error";
  summary: string;
  evidence: string[];
  recommendedAction: CoachAction;
};

export type SpecialistRoute = {
  concern: SpecialistConcern;
  reviewer: string;
  requiredSignalFamilies: SignalFamily[];
  requiredEvidence: string[];
  architectureConcerns: ArchitectureConcern[];
};

export type SpecialistReviewInput = {
  assessment: AssessmentResult;
  telemetry?: ArchitecturalTelemetryBundle;
  availableReviewers?: string[];
};

export type SpecialistReviewRequest = {
  concern: SpecialistConcern;
  reviewer: string;
  signalIds: string[];
  evidence: string[];
  question: string;
  route: SpecialistRoute;
};

export type SpecialistReviewResult = {
  concern: SpecialistConcern;
  reviewer: string;
  findings: ReviewFinding[];
  openQuestions: string[];
  nextAction: CoachAction;
  originalAssessment: {
    action: CoachAction;
    reason: string;
  };
};

export type SpecialistReviewRoutingResult = {
  requests: SpecialistReviewRequest[];
  skipped: Array<{
    concern: SpecialistConcern;
    reason: string;
  }>;
};

export const defaultSpecialistRoutes: SpecialistRoute[] = [
  {
    concern: "security",
    reviewer: "security-reviewer",
    requiredSignalFamilies: ["repository"],
    requiredEvidence: ["auth", "login", "session", "oauth", "password", "account", "permission", "role", "secret", "private data", "public exposure"],
    architectureConcerns: ["authentication", "authorization"],
  },
  {
    concern: "persistence",
    reviewer: "persistence-reviewer",
    requiredSignalFamilies: ["repository"],
    requiredEvidence: ["localstorage", "indexeddb", "sqlite", "postgres", "database", "repository", "storage", "migration", "user data"],
    architectureConcerns: ["data_storage"],
  },
  {
    concern: "deployment",
    reviewer: "deployment-reviewer",
    requiredSignalFamilies: ["repository"],
    requiredEvidence: ["deploy", "hosting", "vercel", "cloudflare", "docker", "production", "health check", "rollback", "secret"],
    architectureConcerns: ["deployment", "observability"],
  },
  {
    concern: "api_contract",
    reviewer: "api-contract-reviewer",
    requiredSignalFamilies: ["repository", "change"],
    requiredEvidence: ["public api", "openapi", "endpoint", "request", "response", "contract", "external"],
    architectureConcerns: ["api_contract"],
  },
  {
    concern: "architecture_spread",
    reviewer: "architecture-reviewer",
    requiredSignalFamilies: ["change"],
    requiredEvidence: ["broad diff", "many files", "changed files", "blast radius"],
    architectureConcerns: ["risk_hotspot"],
  },
];

export function routeSpecialistReviews(
  input: SpecialistReviewInput,
  routes: SpecialistRoute[] = defaultSpecialistRoutes,
): SpecialistReviewRoutingResult {
  const available = input.availableReviewers
    ? new Set(input.availableReviewers)
    : undefined;
  const signals = flattenSignals(input.telemetry);
  const requests: SpecialistReviewRequest[] = [];
  const skipped: SpecialistReviewRoutingResult["skipped"] = [];

  for (const route of routes) {
    if (available && !available.has(route.reviewer)) {
      skipped.push({ concern: route.concern, reason: `${route.reviewer} is unavailable.` });
      continue;
    }
    if (!assessmentMatchesRoute(input.assessment, route)) {
      continue;
    }
    const routeFamilySignals = signals.filter((signal) =>
      route.requiredSignalFamilies.includes(signal.family)
    );
    if (!hasRequiredFamilies(routeFamilySignals, route.requiredSignalFamilies)) {
      skipped.push({ concern: route.concern, reason: "Required telemetry signal family is missing." });
      continue;
    }
    const matchingSignals = routeFamilySignals.filter((signal) => signalMatchesRoute(signal, route));
    if (matchingSignals.length === 0) {
      skipped.push({ concern: route.concern, reason: "Insufficient telemetry-backed evidence." });
      continue;
    }
    const evidence = evidenceFromSignals(matchingSignals);
    if (evidence.length === 0) {
      skipped.push({ concern: route.concern, reason: "Insufficient evidence text for specialist review." });
      continue;
    }
    requests.push({
      concern: route.concern,
      reviewer: route.reviewer,
      signalIds: Array.from(new Set(matchingSignals.map((signal) => signal.id))),
      evidence: evidence.slice(0, 8),
      question: reviewQuestion(route, input.assessment),
      route,
    });
  }

  return { requests: dedupeRequests(requests), skipped };
}

export function formatSpecialistReviewResult(input: {
  request: SpecialistReviewRequest;
  findings?: ReviewFinding[];
  openQuestions?: string[];
  fallbackAction?: CoachAction;
  originalAssessment: AssessmentResult;
}): SpecialistReviewResult {
  const findings = input.findings ?? [];
  return {
    concern: input.request.concern,
    reviewer: input.request.reviewer,
    findings,
    openQuestions: input.openQuestions ?? [],
    nextAction: findings[0]?.recommendedAction
      ?? input.fallbackAction
      ?? input.originalAssessment.action,
    originalAssessment: {
      action: input.originalAssessment.action,
      reason: input.originalAssessment.reason,
    },
  };
}

function assessmentMatchesRoute(
  assessment: AssessmentResult,
  route: SpecialistRoute,
): boolean {
  if (assessment.intervention !== "recommend" && assessment.intervention !== "block") {
    return false;
  }
  return assessment.baseline.concerns.some((concern) =>
    route.architectureConcerns.includes(concern.concern)
    && (concern.thresholdCandidates.length > 0 || concern.facts.length > 0)
  )
    || assessment.questions.some((question) => route.architectureConcerns.includes(question.concern))
    || assessment.evidence.some((evidence) =>
      route.requiredEvidence.some((term) => evidence.summary.toLowerCase().includes(term))
    );
}

function signalMatchesRoute(
  signal: SignalEnvelope<unknown>,
  route: SpecialistRoute,
): boolean {
  if (!route.requiredSignalFamilies.includes(signal.family)) {
    return false;
  }
  const text = JSON.stringify(signal.payload).toLowerCase();
  return route.requiredEvidence.some((term) => text.includes(term));
}

function hasRequiredFamilies(
  signals: SignalEnvelope<unknown>[],
  families: SignalFamily[],
): boolean {
  const present = new Set(signals.map((signal) => signal.family));
  return families.every((family) => present.has(family));
}

function flattenSignals(
  telemetry: ArchitecturalTelemetryBundle | undefined,
): SignalEnvelope<unknown>[] {
  if (!telemetry) {
    return [];
  }
  return [
    ...telemetry.lifecycle,
    ...telemetry.repository,
    ...telemetry.change,
    ...telemetry.test,
    ...telemetry.memory,
    ...telemetry.runtime,
  ];
}

function evidenceFromSignals(signals: SignalEnvelope<unknown>[]): string[] {
  return signals.flatMap((signal) => {
    const payload = signal.payload;
    if (isRecord(payload) && Array.isArray(payload.evidence)) {
      return payload.evidence.filter((item): item is string => typeof item === "string");
    }
    return [];
  });
}

function reviewQuestion(route: SpecialistRoute, assessment: AssessmentResult): string {
  const evidenceHint = assessment.evidence[0]?.summary ?? assessment.reason;
  switch (route.concern) {
    case "security":
      return `Review identity, authorization, protected data, secrets, and public exposure risks. Starting evidence: ${evidenceHint}`;
    case "persistence":
      return `Review persistence ownership, migration, durability, and substrate fit. Starting evidence: ${evidenceHint}`;
    case "deployment":
      return `Review deployment readiness, configuration, secrets, rollback, and operational recovery. Starting evidence: ${evidenceHint}`;
    case "api_contract":
      return `Review request/response compatibility, caller expectations, and failure behavior. Starting evidence: ${evidenceHint}`;
    case "architecture_spread":
      return `Review whether the change spread indicates missing ownership boundaries or module split needs. Starting evidence: ${evidenceHint}`;
  }
}

function dedupeRequests(requests: SpecialistReviewRequest[]): SpecialistReviewRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = `${request.concern}:${request.reviewer}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
