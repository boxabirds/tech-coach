import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  MaturityState,
  OptionalSignalSummary,
  ProtocolValidationIssue,
  SignalStatus,
} from "./protocol.js";
import {
  type ArchitectureBaseline,
  type ArchitectureBaselineSynthesizer,
  type ArchitectureConcern,
  type AxisScore,
  type BaselineConfidence,
  type BaselineConcernAssessment,
  type BaselineDiagnostic,
  type BaselineFact,
  type BaselineFreshness,
  type BaselineInput,
  type BaselineUnknown,
  BaselineValidationError,
  type DecisionAxisAssessment,
  type EvidenceSourceRef,
  type ThresholdCandidate,
} from "./baselineTypes.js";
import {
  combineConfidence,
  combineFactConfidence,
  combineFreshness,
  maxAxisScore,
} from "./baselineConfidence.js";
import type { OptionalSignalResult } from "../../signals/src/index.js";
import { evidenceFromTelemetry } from "./telemetry.js";
import { assessConcernComplexity } from "./complexity.js";

type NormalizedEvidence = {
  source: string;
  status: SignalStatus;
  category: string;
  freshness: BaselineFreshness;
  confidence: BaselineConfidence;
  evidence: string[];
  error?: string;
};

type ConcernDraft = {
  concern: ArchitectureConcern;
  labels: Set<string>;
  sources: EvidenceSourceRef[];
  evidenceText: string[];
  thresholds: Set<ThresholdCandidate>;
  axes: DecisionAxisAssessment;
  hasConflict: boolean;
};

const allConcerns: ArchitectureConcern[] = [
  "application_shape",
  "package_boundary",
  "entrypoint",
  "state_ownership",
  "data_storage",
  "authentication",
  "authorization",
  "deployment",
  "api_contract",
  "background_job",
  "testing",
  "observability",
  "risk_hotspot",
];

const defaultAxes: DecisionAxisAssessment = {
  complexity: "unknown",
  irreversibility: "unknown",
  solutionVisibility: "unknown",
  planningHorizon: "unknown",
};

export function synthesizeArchitectureBaseline(
  input: BaselineInput,
): ArchitectureBaseline {
  validateInput(input);

  const evidenceInput = input.evidence
    ?? (input.telemetry ? evidenceFromTelemetry(input.telemetry) : undefined)
    ?? input.event.optionalSignals;
  const evidence = normalizeEvidence(evidenceInput);
  const priorDecisions = input.priorDecisions ?? input.event.priorDecisions;
  const diagnostics = buildDiagnostics(evidence);
  const drafts = new Map<ArchitectureConcern, ConcernDraft>();

  for (const item of evidence.filter((signal) => signal.status === "present")) {
    const matches = classifyEvidence(item, input.event, priorDecisions);
    for (const match of matches) {
      const draft = getDraft(drafts, match.concern);
      draft.labels.add(match.label);
      draft.sources.push(toSourceRef(item));
      draft.evidenceText.push(...item.evidence);
      draft.hasConflict = draft.hasConflict || match.hasConflict;
      match.thresholds.forEach((threshold) => draft.thresholds.add(threshold));
      draft.axes = mergeAxes(draft.axes, match.axes);
    }
  }

  addChangedFileSpread(drafts, input.event);
  addPriorDecisionRevisits(drafts, input.event, priorDecisions);

  if (drafts.size === 0) {
    diagnostics.push({
      id: "diagnostic-no-evidence",
      severity: "info",
      message: "No concrete architecture evidence was available.",
    });
  }

  const facts: BaselineFact[] = [];
  for (const draft of drafts.values()) {
    const confidence = combineConfidence(draft.sources, draft.hasConflict);
    facts.push({
      id: `fact-${draft.concern}`,
      concern: draft.concern,
      label: Array.from(draft.labels).join("; "),
      status: confidence === "low" ? "inferred" : "observed",
      confidence,
      freshness: combineFreshness(draft.sources),
      sources: uniqueSources(draft.sources),
      summary: summarizeDraft(draft),
    });
  }

  const unknowns = buildUnknowns(facts, evidence, input.event);
  const concerns = buildConcernAssessments(facts, unknowns, drafts, priorDecisions);

  return {
    repoRoot: input.event.cwd,
    generatedAt: new Date().toISOString(),
    concerns,
    facts,
    unknowns,
    diagnostics,
  };
}

export const architectureBaselineSynthesizer: ArchitectureBaselineSynthesizer = {
  synthesize: synthesizeArchitectureBaseline,
};

function validateInput(input: BaselineInput): void {
  const issues: ProtocolValidationIssue[] = [];
  if (!input.event) {
    issues.push({ field: "event", message: "is required" });
  } else if (!input.event.cwd || input.event.cwd.trim().length === 0) {
    issues.push({ field: "event.cwd", message: "must be a non-empty string" });
  }

  const evidence = input.evidence ?? input.event?.optionalSignals ?? [];
  if (!Array.isArray(evidence)) {
    issues.push({ field: "evidence", message: "must be an array" });
  }

  if (issues.length > 0) {
    throw new BaselineValidationError(issues);
  }
}

function normalizeEvidence(
  signals: Array<OptionalSignalResult | OptionalSignalSummary>,
): NormalizedEvidence[] {
  return signals.map((signal, index) => {
    const source = typeof signal.source === "string" ? signal.source : `signal-${index}`;
    const category = typeof signal.category === "string" ? signal.category : "unknown";
    const status = normalizeStatus(signal.status);
    return {
      source,
      status,
      category,
      freshness: normalizeFreshness(readString(signal, "freshness")),
      confidence: normalizeConfidence(readString(signal, "confidence")),
      evidence: Array.isArray(signal.evidence)
        ? signal.evidence.filter((item): item is string => typeof item === "string")
        : [],
      error: typeof signal.error === "string" ? signal.error : undefined,
    };
  });
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

function normalizeStatus(status: unknown): SignalStatus {
  return status === "present" || status === "failed" ? status : "absent";
}

function normalizeFreshness(value: string | undefined): BaselineFreshness {
  return value === "current" || value === "stale" ? value : "unknown";
}

function normalizeConfidence(value: string | undefined): BaselineConfidence {
  return value === "high" || value === "medium" ? value : "low";
}

function buildDiagnostics(evidence: NormalizedEvidence[]): BaselineDiagnostic[] {
  return evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status !== "present")
    .map(({ item, index }) => ({
      id: `diagnostic-${index}-${item.source}`,
      severity: item.status === "failed" ? "warning" : "info",
      source: item.source,
      message: item.error
        ? `${item.source} ${item.status}: ${item.error}`
        : `${item.source} evidence is ${item.status}.`,
    }));
}

function classifyEvidence(
  item: NormalizedEvidence,
  event: CoachEventEnvelope,
  priorDecisions: DecisionRecordSummary[],
): Array<{
  concern: ArchitectureConcern;
  label: string;
  thresholds: ThresholdCandidate[];
  axes: DecisionAxisAssessment;
  hasConflict: boolean;
}> {
  const text = item.evidence.join("\n").toLowerCase();
  const matches: ReturnType<typeof classifyEvidence> = [];
  const add = (
    concern: ArchitectureConcern,
    label: string,
    thresholds: ThresholdCandidate[],
    axes: Partial<DecisionAxisAssessment>,
    hasConflict = false,
  ) => {
    matches.push({
      concern,
      label,
      thresholds,
      axes: { ...defaultAxes, ...axes },
      hasConflict,
    });
  };

  if (
    item.category === "file_layout"
    || item.category === "configuration_boundary"
    || item.category === "architecture_shape"
  ) {
    add("application_shape", "Application structure evidence is present", [], {
      complexity: containsAny(text, ["monorepo", "packages/", "apps/", "react/typescript", "rust crate", "runtime boundary"])
        ? "medium"
        : "low",
      solutionVisibility: "medium",
    });
  }

  if (containsAny(text, [
    "packages/",
    "workspace",
    "monorepo",
    "shared package",
    "package boundary",
    "runtime boundary",
    "rust/wasm",
    "native-module",
  ])) {
    add("package_boundary", "Package or workspace boundaries are visible", [], {
      complexity: "medium",
      solutionVisibility: containsAny(text, ["runtime boundary", "rust/wasm"]) ? "high" : "medium",
    });
  }

  if (containsAny(text, ["entrypoint", "main.ts", "main.tsx", "app.tsx", "route", "handler", "frontend shape"])) {
    add("entrypoint", "Application entry points are visible", [], {
      complexity: "low",
      solutionVisibility: "high",
    });
  }

  if (containsAny(text, ["usestate", "url serialization", "filter state", "shared state", "store"])) {
    const thresholds: ThresholdCandidate[] = ["state_ownership"];
    if (repeatedRequestPressure(event) || containsAny(text, ["repeat", "duplicate", "duplicated", "repeated"])) {
      thresholds.push("repetition");
    }
    add("state_ownership", "State ownership pressure is visible", thresholds, {
      complexity: "medium",
      irreversibility: "medium",
      solutionVisibility: "medium",
      planningHorizon: repeatedRequestPressure(event) ? "high" : "medium",
    });
  }

  if (containsAny(text, ["localstorage", "indexeddb", "sqlite", "postgres", "database", "repository", "storage"])) {
    const thresholds: ThresholdCandidate[] = ["persistence"];
    if (containsAny(text, ["share", "sharing", "sync", "team", "multi-user", "collaboration", "collaborative"])) {
      thresholds.push("collaboration");
    }
    add("data_storage", "Persistence or storage behavior is visible", thresholds, {
      complexity: "medium",
      irreversibility: containsAny(text, ["migration", "production", "user data"])
        ? "high"
        : "medium",
      solutionVisibility: containsAny(text, ["repository", "adapter"])
        ? "high"
        : "medium",
      planningHorizon: repeatedRequestPressure(event) ? "high" : "medium",
    });
  }

  if (containsAny(text, ["auth", "login", "session", "oauth", "password", "account"])) {
    add("authentication", "Authentication or identity behavior is visible", [
      "identity",
      "security",
    ], {
      complexity: "high",
      irreversibility: "high",
      solutionVisibility: "medium",
      planningHorizon: "high",
    });
  }

  if (containsAny(text, ["permission", "role", "rbac", "authorization", "access control"])) {
    add("authorization", "Authorization behavior is visible", [
      "security",
    ], {
      complexity: "high",
      irreversibility: "high",
      solutionVisibility: "medium",
      planningHorizon: "high",
    });
  }

  if (containsAny(text, ["deploy", "hosting", "vercel", "cloudflare", "docker", "production"])) {
    add("deployment", "Deployment or hosting evidence is visible", [
      "deployment",
    ], {
      complexity: "medium",
      irreversibility: containsAny(text, ["production", "public"]) ? "high" : "medium",
      solutionVisibility: "medium",
      planningHorizon: "medium",
    });
  }

  if (containsAny(text, ["public api", "openapi", "endpoint", "request", "response", "contract"])) {
    add("api_contract", "API contract evidence is visible", [
      "public_api",
    ], {
      complexity: "medium",
      irreversibility: containsAny(text, ["public", "external"]) ? "high" : "medium",
      solutionVisibility: "medium",
      planningHorizon: "high",
    });
  }

  if (containsAny(text, ["queue", "cron", "worker", "background job"])) {
    add("background_job", "Background processing evidence is visible", [], {
      complexity: "medium",
      irreversibility: "medium",
      solutionVisibility: "medium",
      planningHorizon: "medium",
    });
  }

  if (item.category === "test_posture" || containsAny(text, ["vitest", "playwright", "test", "coverage", "test surface"])) {
    add("testing", "Test posture evidence is visible", [], {
      complexity: "low",
      solutionVisibility: "high",
    });
  }

  if (
    item.category === "runtime_error"
    || item.category === "monitor_event"
    || containsAny(text, ["log", "metric", "alert", "runtime error", "health check"])
  ) {
    add("observability", "Runtime or observability evidence is visible", [
      "operational",
    ], {
      complexity: "medium",
      irreversibility: "medium",
      solutionVisibility: "medium",
      planningHorizon: "high",
    });
  }

  if (
    item.category === "diagnostic"
    || containsAny(text, ["failing", "error", "broad diff", "many files"])
  ) {
    add("risk_hotspot", "Risk hotspot evidence is visible", [
      "blast_radius",
    ], {
      complexity: "high",
      irreversibility: "medium",
      solutionVisibility: "low",
      planningHorizon: "high",
    }, containsAny(text, ["conflict", "contradict"]));
  }

  if (matches.length === 0 && item.evidence.length > 0) {
    add("unknown", "Evidence does not map to a known architectural concern", [], {
      complexity: "unknown",
    });
  }

  addRevisitMatches(matches, item, priorDecisions);
  return matches;
}

function addChangedFileSpread(
  drafts: Map<ArchitectureConcern, ConcernDraft>,
  event: CoachEventEnvelope,
): void {
  if (event.changedFiles.length < 4) {
    return;
  }
  const roots = new Set(event.changedFiles.map((file) => file.split("/")[0]));
  if (roots.size < 2 && event.changedFiles.length < 6) {
    return;
  }

  const draft = getDraft(drafts, "risk_hotspot");
  draft.labels.add("Change touches a broad file spread");
  draft.sources.push({
    source: "event.changedFiles",
    category: "changed_file_spread",
    status: "present",
    freshness: "current",
    confidence: "medium",
  });
  draft.evidenceText.push(...event.changedFiles);
  draft.thresholds.add("blast_radius");
  draft.axes = mergeAxes(draft.axes, {
    complexity: "high",
    irreversibility: "medium",
    solutionVisibility: "low",
    planningHorizon: "high",
  });
}

function addPriorDecisionRevisits(
  drafts: Map<ArchitectureConcern, ConcernDraft>,
  event: CoachEventEnvelope,
  decisions: DecisionRecordSummary[],
): void {
  const requestText = [
    event.userRequest,
    ...event.recentRequests,
    ...event.changedFiles,
  ].join("\n").toLowerCase();

  for (const decision of decisions) {
    const matched = decision.revisitIf?.find((condition) =>
      textMatchesCondition(requestText, condition),
    );
    if (!matched) {
      continue;
    }

    const concern = mapDecisionConcern(decision.concern);
    const draft = getDraft(drafts, concern);
    draft.labels.add(`Prior decision ${decision.id ?? "unknown"} may need revisit`);
    draft.sources.push({
      source: decision.id ?? "priorDecision",
      category: "prior_decision",
      status: "present",
      freshness: "current",
      confidence: "medium",
    });
    draft.evidenceText.push(`revisit_if matched: ${matched}`);
    draft.thresholds.add("revisit");
    draft.axes = mergeAxes(draft.axes, {
      complexity: "medium",
      irreversibility: "medium",
      solutionVisibility: "low",
      planningHorizon: "high",
    });
  }
}

function addRevisitMatches(
  matches: ReturnType<typeof classifyEvidence>,
  item: NormalizedEvidence,
  decisions: DecisionRecordSummary[],
): void {
  const text = item.evidence.join("\n").toLowerCase();
  for (const decision of decisions) {
    const matched = decision.revisitIf?.some((condition) =>
      textMatchesCondition(text, condition),
    );
    if (!matched) {
      continue;
    }
    matches.push({
      concern: mapDecisionConcern(decision.concern),
      label: `Evidence matches revisit trigger for ${decision.id ?? "prior decision"}`,
      thresholds: ["revisit"],
      axes: {
        complexity: "medium",
        irreversibility: "medium",
        solutionVisibility: "low",
        planningHorizon: "high",
      },
      hasConflict: false,
    });
  }
}

function getDraft(
  drafts: Map<ArchitectureConcern, ConcernDraft>,
  concern: ArchitectureConcern,
): ConcernDraft {
  const existing = drafts.get(concern);
  if (existing) {
    return existing;
  }

  const draft: ConcernDraft = {
    concern,
    labels: new Set(),
    sources: [],
    evidenceText: [],
    thresholds: new Set(),
    axes: { ...defaultAxes },
    hasConflict: false,
  };
  drafts.set(concern, draft);
  return draft;
}

function toSourceRef(item: NormalizedEvidence): EvidenceSourceRef {
  return {
    source: item.source,
    category: item.category,
    status: item.status,
    freshness: item.freshness,
    confidence: item.confidence,
  };
}

function mergeAxes(
  left: DecisionAxisAssessment,
  right: Partial<DecisionAxisAssessment>,
): DecisionAxisAssessment {
  return {
    complexity: maxAxisScore([left.complexity, right.complexity ?? "unknown"]),
    irreversibility: maxAxisScore([
      left.irreversibility,
      right.irreversibility ?? "unknown",
    ]),
    solutionVisibility: maxAxisScore([
      left.solutionVisibility,
      right.solutionVisibility ?? "unknown",
    ]),
    planningHorizon: maxAxisScore([
      left.planningHorizon,
      right.planningHorizon ?? "unknown",
    ]),
  };
}

function buildUnknowns(
  facts: BaselineFact[],
  evidence: NormalizedEvidence[],
  event: CoachEventEnvelope,
): BaselineUnknown[] {
  const knownConcerns = new Set(facts.map((fact) => fact.concern));
  const evidenceAbsent = evidence.length === 0;
  const unknowns: BaselineUnknown[] = [];

  for (const concern of allConcerns) {
    if (knownConcerns.has(concern)) {
      continue;
    }
    if (shouldAlwaysTrackUnknown(concern) || evidenceAbsent) {
      unknowns.push({
        id: `unknown-${concern}`,
        concern,
        reason: evidenceAbsent
          ? "No shared evidence was available for this repository yet."
          : "Available evidence did not establish this concern.",
        neededEvidence: neededEvidenceFor(concern, event),
      });
    }
  }

  return unknowns;
}

function buildConcernAssessments(
  facts: BaselineFact[],
  unknowns: BaselineUnknown[],
  drafts: Map<ArchitectureConcern, ConcernDraft>,
  priorDecisions: DecisionRecordSummary[],
): BaselineConcernAssessment[] {
  const concerns = new Set<ArchitectureConcern>([
    ...facts.map((fact) => fact.concern),
    ...unknowns.map((unknown) => unknown.concern),
  ]);

  return Array.from(concerns).map((concern) => {
    const concernFacts = facts.filter((fact) => fact.concern === concern);
    const concernUnknowns = unknowns.filter((unknown) => unknown.concern === concern);
    const draft = drafts.get(concern);
    const confidence = combineFactConfidence(concernFacts);
    const currentState = estimateMaturityState(
      concern,
      concernFacts,
      draft,
      priorDecisions,
    );
    const assessment: BaselineConcernAssessment = {
      concern,
      currentState,
      confidence,
      axes: draft?.axes ?? { ...defaultAxes },
      thresholdCandidates: Array.from(draft?.thresholds ?? []),
      facts: concernFacts,
      unknowns: concernUnknowns,
      rationale: buildRationale(concern, currentState, concernFacts, concernUnknowns),
    };
    const complexity = assessConcernComplexity(assessment);
    return {
      ...assessment,
      pressure: complexity.pressure,
      support: complexity.support,
      adequacy: complexity.adequacy,
    };
  });
}

function estimateMaturityState(
  concern: ArchitectureConcern,
  facts: BaselineFact[],
  draft: ConcernDraft | undefined,
  priorDecisions: DecisionRecordSummary[],
): MaturityState {
  if (facts.length === 0) {
    return "Exploratory";
  }
  const confidence = combineFactConfidence(facts);
  if (confidence === "low") {
    return "Exploratory";
  }
  if (draft?.thresholds.has("revisit")) {
    return "Revisit";
  }

  const decisionForConcern = priorDecisions.find(
    (decision) => mapDecisionConcern(decision.concern) === concern,
  );
  if (decisionForConcern) {
    return draft?.thresholds.has("persistence")
      || draft?.thresholds.has("security")
      || draft?.thresholds.has("public_api")
      ? "LoadBearing"
      : "Owned";
  }

  if (
    draft?.thresholds.has("security")
    || draft?.thresholds.has("deployment")
    || draft?.thresholds.has("operational")
    || draft?.thresholds.has("public_api")
  ) {
    return confidence === "high" ? "LoadBearing" : "Owned";
  }
  if (draft?.thresholds.has("persistence") || draft?.thresholds.has("state_ownership")) {
    return confidence === "high" ? "Owned" : "Named";
  }
  if (confidence === "high") {
    return "Named";
  }
  if (confidence === "medium") {
    return "Emerging";
  }
  return "Exploratory";
}

function summarizeDraft(draft: ConcernDraft): string {
  const evidence = draft.evidenceText.slice(0, 3).join("; ");
  return evidence.length > 0
    ? `${Array.from(draft.labels).join("; ")}. Evidence: ${evidence}`
    : Array.from(draft.labels).join("; ");
}

function buildRationale(
  concern: ArchitectureConcern,
  state: MaturityState,
  facts: BaselineFact[],
  unknowns: BaselineUnknown[],
): string {
  if (facts.length === 0) {
    return `${concern} remains ${state} because no concrete evidence established it.`;
  }
  if (unknowns.length > 0) {
    return `${concern} appears ${state}, with unresolved baseline questions.`;
  }
  return `${concern} appears ${state} based on ${facts.length} baseline fact(s).`;
}

function uniqueSources(sources: EvidenceSourceRef[]): EvidenceSourceRef[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source}:${source.category}:${source.status}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function textMatchesCondition(text: string, condition: string): boolean {
  const normalized = condition.toLowerCase();
  if (text.includes(normalized)) {
    return true;
  }
  if (normalized.endsWith("ing") && text.includes(normalized.slice(0, -3))) {
    return true;
  }
  if (normalized.endsWith("e") && text.includes(`${normalized.slice(0, -1)}ing`)) {
    return true;
  }
  return false;
}

function repeatedRequestPressure(event: CoachEventEnvelope): boolean {
  return event.recentRequests.length >= 2 || event.changedFiles.length >= 3;
}

function shouldAlwaysTrackUnknown(concern: ArchitectureConcern): boolean {
  return [
    "data_storage",
    "authentication",
    "authorization",
    "deployment",
    "api_contract",
    "testing",
  ].includes(concern);
}

function neededEvidenceFor(
  concern: ArchitectureConcern,
  event: CoachEventEnvelope,
): string[] {
  const base = event.changedFiles.length > 0
    ? ["changed-file evidence", "shared optional evidence"]
    : ["repo layout evidence", "shared optional evidence"];
  switch (concern) {
    case "data_storage":
      return [...base, "storage/config/import evidence"];
    case "authentication":
    case "authorization":
      return [...base, "identity and access-control evidence"];
    case "deployment":
      return [...base, "hosting/config evidence"];
    case "api_contract":
      return [...base, "route or public contract evidence"];
    case "testing":
      return [...base, "test posture evidence"];
    default:
      return base;
  }
}

function mapDecisionConcern(concern: string | undefined): ArchitectureConcern {
  const normalized = concern?.toLowerCase() ?? "";
  if (normalized.includes("persist") || normalized.includes("storage")) {
    return "data_storage";
  }
  if (normalized.includes("auth")) {
    return "authentication";
  }
  if (normalized.includes("deploy")) {
    return "deployment";
  }
  if (normalized.includes("api")) {
    return "api_contract";
  }
  if (normalized.includes("state")) {
    return "state_ownership";
  }
  return "unknown";
}
