import type {
  ArchitectureConcern,
  BaselineConcernAssessment,
  BaselineFact,
  BaselineInterviewInput,
  BaselineInterviewPlanner,
  BaselineQuestion,
  BaselineUnknown,
} from "./baselineTypes.js";
import type {
  ArchitecturalTelemetryBundle,
  LifecycleSignal,
  RepositorySignal,
  SignalEnvelope,
  SignalFamily,
} from "./telemetryTypes.js";
import type {
  InteractionGuidance,
  LanguageComfort,
  QuestionStyle,
} from "../../signals/src/historyTypes.js";

type QuestionCandidate = BaselineQuestion & {
  score: number;
  rankKey: string;
};

type AnySignal = SignalEnvelope<unknown>;

const defaultQuestionLimit = 4;

const concernPriority: Record<ArchitectureConcern, number> = {
  data_storage: 100,
  authentication: 95,
  authorization: 90,
  deployment: 85,
  api_contract: 80,
  state_ownership: 75,
  risk_hotspot: 70,
  testing: 60,
  observability: 55,
  background_job: 45,
  package_boundary: 35,
  application_shape: 30,
  entrypoint: 25,
  unknown: 0,
};

const signalConcernMap: Record<SignalFamily, ArchitectureConcern> = {
  lifecycle: "risk_hotspot",
  repository: "application_shape",
  change: "risk_hotspot",
  test: "testing",
  memory: "risk_hotspot",
  runtime: "observability",
};

export function planBaselineInterviewQuestions(
  input: BaselineInterviewInput,
  limit = defaultQuestionLimit,
): BaselineQuestion[] {
  if (limit <= 0 || isLowSignalGreenfield(input)) {
    return [];
  }

  const interactionGuidance = interactionGuidanceFromTelemetry(input.telemetry);
  const candidates = [
    ...questionCandidatesFromFacts(input),
    ...questionCandidatesFromUnknowns(input),
    ...questionCandidatesFromTelemetry(input),
  ];

  const selected = new Map<string, QuestionCandidate>();
  for (const candidate of candidates) {
    const existing = selected.get(candidate.id);
    if (!existing || candidate.score > existing.score) {
      selected.set(candidate.id, candidate);
    }
  }

  return Array.from(selected.values())
    .sort((left, right) =>
      right.score - left.score || left.rankKey.localeCompare(right.rankKey)
    )
    .slice(0, limit)
    .map(({ score: _score, rankKey: _rankKey, ...question }) =>
      applyInteractionGuidance(question, interactionGuidance)
    );
}

export const baselineInterviewPlanner: BaselineInterviewPlanner = {
  planQuestions: planBaselineInterviewQuestions,
};

function questionCandidatesFromFacts(
  input: BaselineInterviewInput,
): QuestionCandidate[] {
  return input.baseline.facts
    .filter((fact) => shouldAskAboutFact(fact))
    .map((fact) => {
      const concern = findConcern(input.baseline.concerns, fact.concern);
      const relatedSignalIds = relatedSignalsForFact(input.telemetry, fact);
      return {
        id: stableQuestionId("fact", fact.concern, fact.id),
        concern: fact.concern,
        kind: questionKindForFact(fact),
        prompt: promptForFact(fact),
        reason: reasonForFact(fact, concern),
        relatedFactIds: [fact.id],
        relatedUnknownIds: [],
        relatedSignalIds,
        options: optionsForConcern(fact.concern),
        score: scoreFact(fact, concern, relatedSignalIds),
        rankKey: `${concernPriority[fact.concern]}:${fact.id}`,
      };
    });
}

function questionCandidatesFromUnknowns(
  input: BaselineInterviewInput,
): QuestionCandidate[] {
  if (input.baseline.facts.length === 0) {
    return [];
  }

  return input.baseline.unknowns
    .filter((unknown) => isHighImpactConcern(unknown.concern))
    .map((unknown) => ({
      id: stableQuestionId("unknown", unknown.concern, unknown.id),
      concern: unknown.concern,
      kind: "choose",
      prompt: promptForUnknown(unknown),
      reason: `The baseline has project evidence, but ${unknown.concern} is still unresolved: ${unknown.reason}`,
      relatedFactIds: [],
      relatedUnknownIds: [unknown.id],
      relatedSignalIds: [],
      options: optionsForConcern(unknown.concern),
      score: concernPriority[unknown.concern] + 10,
      rankKey: `${concernPriority[unknown.concern]}:${unknown.id}`,
    }));
}

function questionCandidatesFromTelemetry(
  input: BaselineInterviewInput,
): QuestionCandidate[] {
  const telemetry = input.telemetry;
  if (!telemetry || input.baseline.facts.length === 0) {
    return [];
  }

  return telemetry.diagnostics
    .filter((diagnostic) =>
      diagnostic.family
      && (diagnostic.severity !== "info" || isConflictText(diagnostic.message))
    )
    .map((diagnostic) => {
      const family = diagnostic.family as SignalFamily;
      const concern = signalConcernMap[family];
      return {
        id: stableQuestionId("signal", concern, diagnostic.id),
        concern,
        kind: isConflictText(diagnostic.message) ? "correct" : "free_text",
        prompt: promptForSignalFamily(family, concern),
        reason: diagnostic.message,
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [diagnostic.id],
        options: optionsForConcern(concern),
        score: concernPriority[concern] + (diagnostic.severity === "warning" ? 20 : 5),
        rankKey: `${concernPriority[concern]}:${diagnostic.id}`,
      };
    });
}

function shouldAskAboutFact(fact: BaselineFact): boolean {
  return (
    isHighImpactConcern(fact.concern)
    && (
      fact.status === "inferred"
      || fact.confidence !== "high"
      || fact.freshness !== "current"
    )
  );
}

function isHighImpactConcern(concern: ArchitectureConcern): boolean {
  return concernPriority[concern] >= 55;
}

function isLowSignalGreenfield(input: BaselineInterviewInput): boolean {
  return input.baseline.facts.length === 0
    && input.baseline.diagnostics.every((diagnostic) => diagnostic.severity === "info")
    && !hasPresentTelemetry(input.telemetry);
}

function hasPresentTelemetry(
  telemetry: ArchitecturalTelemetryBundle | undefined,
): boolean {
  if (!telemetry) {
    return false;
  }
  return allSignals(telemetry).some((signal) => signal.status === "present");
}

function allSignals(telemetry: ArchitecturalTelemetryBundle): AnySignal[] {
  return [
    ...telemetry.lifecycle,
    ...telemetry.repository,
    ...telemetry.change,
    ...telemetry.test,
    ...telemetry.memory,
    ...telemetry.runtime,
  ];
}

function interactionGuidanceFromTelemetry(
  telemetry: ArchitecturalTelemetryBundle | undefined,
): InteractionGuidance | undefined {
  if (!telemetry) {
    return undefined;
  }

  const historyGuidance = telemetry.repository
    .map((signal) => readInteractionGuidance(signal))
    .find((guidance): guidance is InteractionGuidance => Boolean(guidance));
  const currentStyle = questionStyleFromCurrentRequest(telemetry.lifecycle);

  if (!currentStyle) {
    return historyGuidance;
  }

  return {
    languageComfort: languageComfortForCurrentStyle(
      currentStyle,
      historyGuidance?.languageComfort,
    ),
    questionStyle: currentStyle,
    rationale: historyGuidance
      ? `Current request overrides history-derived question style. ${historyGuidance.rationale}`
      : "Current request sets the interaction style for this turn.",
    suggestedQuestion: suggestedQuestionForStyle(currentStyle),
  };
}

function readInteractionGuidance(
  signal: SignalEnvelope<RepositorySignal>,
): InteractionGuidance | undefined {
  const details = signal.payload.details;
  if (!details || !isRecord(details.interactionGuidance)) {
    return undefined;
  }
  const guidance = details.interactionGuidance;
  if (
    isLanguageComfort(guidance.languageComfort)
    && isQuestionStyle(guidance.questionStyle)
    && typeof guidance.rationale === "string"
    && typeof guidance.suggestedQuestion === "string"
  ) {
    return {
      languageComfort: guidance.languageComfort,
      questionStyle: guidance.questionStyle,
      rationale: guidance.rationale,
      suggestedQuestion: guidance.suggestedQuestion,
    };
  }
  return undefined;
}

function questionStyleFromCurrentRequest(
  lifecycle: SignalEnvelope<LifecycleSignal>[],
): QuestionStyle | undefined {
  const latest = lifecycle.at(-1)?.payload;
  const text = [
    latest?.userRequest,
    ...(latest?.recentRequests.slice(-2) ?? []),
  ].join("\n").toLowerCase();

  if (containsAny(text, ["gdpr", "privacy", "compliance", "audit", "retention", "deletion"])) {
    return "risk_compliance";
  }
  if (containsAny(text, ["sql", "nosql", "database", "technical", "tradeoff", "architecture"])) {
    return "technical_choice";
  }
  if (containsAny(text, ["user outcome", "business", "customer", "workflow", "sharing", "search", "export"])) {
    return "business_outcome";
  }
  return undefined;
}

function applyInteractionGuidance(
  question: BaselineQuestion,
  guidance: InteractionGuidance | undefined,
): BaselineQuestion {
  if (!guidance) {
    return question;
  }

  return {
    ...question,
    interactionGuidance: guidance,
    prompt: guidedPrompt(question, guidance.questionStyle),
  };
}

function guidedPrompt(
  question: BaselineQuestion,
  style: QuestionStyle,
): string {
  switch (question.concern) {
    case "data_storage":
      return storagePromptForStyle(style, question.prompt);
    case "authentication":
      return authPromptForStyle(style, question.prompt);
    case "authorization":
      return authorizationPromptForStyle(style, question.prompt);
    case "deployment":
      return deploymentPromptForStyle(style, question.prompt);
    case "api_contract":
      return apiPromptForStyle(style, question.prompt);
    case "state_ownership":
      return statePromptForStyle(style, question.prompt);
    case "testing":
      return testingPromptForStyle(style, question.prompt);
    case "observability":
      return observabilityPromptForStyle(style, question.prompt);
    default:
      return fallbackPromptForStyle(style, question.prompt);
  }
}

function storagePromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Do you want the coach to assume SQL/relational storage, document/NoSQL storage, or local-only storage for now?";
    case "business_outcome":
      return "What user outcome should storage support next: search, sharing, export, audit, deletion, or offline use?";
    case "risk_compliance":
      return "Are there privacy, retention, deletion, access-control, audit, or GDPR obligations the storage design must preserve?";
    case "guided_default":
      return fallback;
  }
}

function authPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Which identity boundary should the coach assume: no auth, local-only user, session login, or external identity provider?";
    case "business_outcome":
      return "Who needs access to this system next, and what should they be able to do?";
    case "risk_compliance":
      return "Are there account, session, credential, or audit obligations the authentication design must preserve?";
    case "guided_default":
      return fallback;
  }
}

function authorizationPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Should the coach assume no roles, admin-only controls, role-based access, or resource-level permissions?";
    case "business_outcome":
      return "Which user groups or workflows need different access rules?";
    case "risk_compliance":
      return "Are there permission, segregation-of-duty, audit, or data-access obligations the authorization design must preserve?";
    case "guided_default":
      return fallback;
  }
}

function deploymentPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Should the coach assume local-only use, private hosting, public hosting, or production service deployment?";
    case "business_outcome":
      return "Who needs to use this outside your machine, and how reliable does access need to be?";
    case "risk_compliance":
      return "Are there hosting, data residency, audit, rollback, or operational obligations the deployment design must preserve?";
    case "guided_default":
      return fallback;
  }
}

function apiPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Should the coach treat this API as internal only, stable internal, public, or depended on by external systems?";
    case "business_outcome":
      return "Which product or partner workflow needs this API to remain stable?";
    case "risk_compliance":
      return "Are there compatibility, access-control, audit, or versioning obligations this API contract must preserve?";
    case "guided_default":
      return fallback;
  }
}

function statePromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "Should the coach assume this state is component-local, shared client state, server-owned, or persistent workflow state?";
    case "business_outcome":
      return "Which user workflow should state changes protect from being lost or inconsistent?";
    case "risk_compliance":
      return "Are there consistency, recovery, audit, or deletion obligations this state design must preserve?";
    case "guided_default":
      return fallback;
  }
}

function testingPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "What test level should the coach trust here: unit, integration, end-to-end, manual verification, or none yet?";
    case "business_outcome":
      return "Which user workflow would be most costly if this change broke?";
    case "risk_compliance":
      return "Are there security, privacy, compliance, or rollback risks that need explicit test evidence?";
    case "guided_default":
      return fallback;
  }
}

function observabilityPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return "What runtime evidence should the coach trust: logs, metrics, traces, health checks, alerts, or manual reports?";
    case "business_outcome":
      return "Which user-visible failure would you need to detect quickly?";
    case "risk_compliance":
      return "Are there audit, incident, retention, or availability obligations runtime monitoring must preserve?";
    case "guided_default":
      return fallback;
  }
}

function fallbackPromptForStyle(style: QuestionStyle, fallback: string): string {
  switch (style) {
    case "technical_choice":
      return `${fallback} If there is a technical preference, state it; otherwise the coach will choose a reversible default.`;
    case "business_outcome":
      return `${fallback} Tie the answer to the user or business outcome that matters next.`;
    case "risk_compliance":
      return `${fallback} Include any privacy, security, retention, access-control, or audit obligations.`;
    case "guided_default":
      return fallback;
  }
}

function languageComfortForCurrentStyle(
  style: QuestionStyle,
  fallback: LanguageComfort | undefined,
): LanguageComfort {
  switch (style) {
    case "technical_choice":
      return fallback === "outcome_oriented" ? "mixed" : "technical";
    case "business_outcome":
    case "risk_compliance":
      return fallback === "technical" ? "mixed" : "outcome_oriented";
    case "guided_default":
      return fallback ?? "unknown";
  }
}

function suggestedQuestionForStyle(style: QuestionStyle): string {
  switch (style) {
    case "technical_choice":
      return "Do you have a technical preference for this boundary, or should the coach choose a reversible default?";
    case "business_outcome":
      return "What user outcome should this architecture decision protect next?";
    case "risk_compliance":
      return "Are there privacy, retention, access-control, audit, or compliance obligations the coach should preserve?";
    case "guided_default":
      return "The coach can use a reversible default for now; is that acceptable?";
  }
}

function relatedSignalsForFact(
  telemetry: ArchitecturalTelemetryBundle | undefined,
  fact: BaselineFact,
): string[] {
  if (!telemetry) {
    return [];
  }

  const sources = new Set(fact.sources.map((source) => source.source));
  const categories = new Set(fact.sources.map((source) => source.category));
  return allSignals(telemetry)
    .filter((signal) =>
      sources.has(signal.source)
      || categories.has(readPayloadCategory(signal.payload))
    )
    .map((signal) => signal.id);
}

function readPayloadCategory(payload: unknown): string {
  if (
    payload
    && typeof payload === "object"
    && "category" in payload
    && typeof payload.category === "string"
  ) {
    return payload.category;
  }
  return "";
}

function scoreFact(
  fact: BaselineFact,
  concern: BaselineConcernAssessment | undefined,
  relatedSignalIds: string[],
): number {
  const confidenceScore = fact.confidence === "low"
    ? 30
    : fact.confidence === "medium"
      ? 20
      : 0;
  const statusScore = fact.status === "inferred" ? 25 : 0;
  const freshnessScore = fact.freshness === "stale" ? 15 : 0;
  const thresholdScore = (concern?.thresholdCandidates.length ?? 0) * 6;
  const signalScore = relatedSignalIds.length > 0 ? 4 : 0;
  return concernPriority[fact.concern]
    + confidenceScore
    + statusScore
    + freshnessScore
    + thresholdScore
    + signalScore;
}

function findConcern(
  concerns: BaselineConcernAssessment[],
  concern: ArchitectureConcern,
): BaselineConcernAssessment | undefined {
  return concerns.find((item) => item.concern === concern);
}

function questionKindForFact(fact: BaselineFact): BaselineQuestion["kind"] {
  if (fact.status === "inferred" || fact.confidence === "low") {
    return "correct";
  }
  return "confirm";
}

function promptForFact(fact: BaselineFact): string {
  switch (fact.concern) {
    case "data_storage":
      return `Should the coach treat this persistence finding as intentional project direction: ${fact.summary}`;
    case "authentication":
      return `Should the coach treat this authentication boundary as real project intent: ${fact.summary}`;
    case "authorization":
      return `Should the coach treat this authorization boundary as real project intent: ${fact.summary}`;
    case "deployment":
      return `Should the coach treat this deployment expectation as real project intent: ${fact.summary}`;
    case "api_contract":
      return `Should the coach treat this API contract as load-bearing project intent: ${fact.summary}`;
    case "state_ownership":
      return `Should the coach treat this state ownership pressure as important project direction: ${fact.summary}`;
    case "risk_hotspot":
      return `Should the coach treat this risk hotspot as an active constraint: ${fact.summary}`;
    case "testing":
      return `Should the coach treat this test posture as current and reliable: ${fact.summary}`;
    case "observability":
      return `Should the coach treat this runtime or observability signal as current project reality: ${fact.summary}`;
    default:
      return `Should the coach treat this baseline fact as project intent: ${fact.summary}`;
  }
}

function promptForUnknown(unknown: BaselineUnknown): string {
  switch (unknown.concern) {
    case "data_storage":
      return "What persistence model should the coach assume for this project right now?";
    case "authentication":
      return "What authentication boundary should the coach assume for this project right now?";
    case "authorization":
      return "What authorization or role boundary should the coach assume for this project right now?";
    case "deployment":
      return "What deployment target or sharing expectation should the coach assume right now?";
    case "api_contract":
      return "Are any APIs in this project intended to become public or externally depended on?";
    case "state_ownership":
      return "Where should the coach assume important shared state is owned right now?";
    case "testing":
      return "What test posture should the coach treat as current for this project?";
    case "observability":
      return "What runtime feedback should the coach assume is available for this project?";
    default:
      return `What should the coach assume about ${unknown.concern} right now?`;
  }
}

function promptForSignalFamily(
  family: SignalFamily,
  concern: ArchitectureConcern,
): string {
  switch (family) {
    case "repository":
      return "The repository signal is incomplete. What project structure should the coach assume?";
    case "change":
      return "The change signal is incomplete or conflicting. What part of this change is architecturally important?";
    case "test":
      return "The test signal is incomplete or stale. What test evidence should the coach trust?";
    case "memory":
      return "The decision memory signal is incomplete. Are there known shortcuts or prior decisions the coach should respect?";
    case "runtime":
      return "The runtime signal is incomplete or failing. What operational evidence should the coach consider current?";
    case "lifecycle":
      return "The host lifecycle signal is incomplete. What current work context should the coach assume?";
    default:
      return `What should the coach assume about ${concern} right now?`;
  }
}

function reasonForFact(
  fact: BaselineFact,
  concern: BaselineConcernAssessment | undefined,
): string {
  const reasons = [
    `${fact.status} ${fact.concern} fact with ${fact.confidence} confidence`,
    fact.freshness === "current" ? undefined : `${fact.freshness} evidence`,
    concern?.thresholdCandidates.length
      ? `may affect ${concern.thresholdCandidates.join(", ")} decisions`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return reasons.join("; ");
}

function optionsForConcern(concern: ArchitectureConcern): string[] | undefined {
  switch (concern) {
    case "data_storage":
      return ["temporary local-only storage", "durable single-user storage", "shared multi-user database", "unknown"];
    case "authentication":
      return ["no authentication yet", "single-user local assumption", "session/account login", "external identity provider", "unknown"];
    case "authorization":
      return ["no roles yet", "admin-only controls", "role-based access", "resource-level permissions", "unknown"];
    case "deployment":
      return ["local only", "private hosted app", "public hosted app", "production service", "unknown"];
    case "api_contract":
      return ["internal only", "stable internal contract", "public API", "partner/external dependency", "unknown"];
    case "state_ownership":
      return ["component-local state", "shared client state", "server-owned state", "persistent workflow state", "unknown"];
    case "testing":
      return ["not established", "unit tests only", "integration coverage", "end-to-end coverage", "unknown"];
    default:
      return undefined;
  }
}

function isConflictText(message: string): boolean {
  return /\b(conflict|conflicting|contradict|contradiction)\b/i.test(message);
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguageComfort(value: unknown): value is LanguageComfort {
  return (
    value === "technical"
    || value === "mixed"
    || value === "outcome_oriented"
    || value === "unknown"
  );
}

function isQuestionStyle(value: unknown): value is QuestionStyle {
  return (
    value === "technical_choice"
    || value === "business_outcome"
    || value === "risk_compliance"
    || value === "guided_default"
  );
}

function stableQuestionId(
  prefix: string,
  concern: ArchitectureConcern,
  key: string,
): string {
  return `question-${prefix}-${concern}-${sanitizeId(key)}`;
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
