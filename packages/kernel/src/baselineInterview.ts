import type {
  ArchitectureConcern,
  BaselineConcernAssessment,
  BaselineFact,
  BaselineInterviewInput,
  BaselineInterviewPlanner,
  BaselineQuestion,
  BaselineUnknown,
} from "./baselineTypes.js";
import type { ArchitectureClaim } from "./claimTypes.js";
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
  if (limit <= 0 || input.interactionContext === "passive_baseline" || isLowSignalGreenfield(input)) {
    return [];
  }

  const interactionGuidance = interactionGuidanceFromTelemetry(input.telemetry);
  const candidates = [
    ...questionCandidatesFromFacts(input),
    ...questionCandidatesFromUnknowns(input),
    ...questionCandidatesFromTelemetry(input),
    ...questionCandidatesFromClaims(input),
  ];

  const selected = new Map<string, QuestionCandidate>();
  for (const candidate of candidates.filter((candidate) =>
    !isSuppressedByClaim(candidate, input.claims ?? [])
    && isAskableUserIntentQuestion(candidate)
  )) {
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

function questionCandidatesFromClaims(
  input: BaselineInterviewInput,
): QuestionCandidate[] {
  return (input.claims ?? [])
    .flatMap((claim, index) => askableClaimResiduals(claim).slice(0, 2).map((unknown, unknownIndex) => ({
      id: stableQuestionId("claim", claim.concern, `${claim.id}-${unknownIndex}`),
      concern: claim.concern,
      kind: "choose" as const,
      prompt: residualPromptForClaim(claim, unknown),
      reason: "Repository evidence answers the current shape; this asks which future risk or direction should drive the next architecture move.",
      relatedFactIds: [],
      relatedUnknownIds: [],
      relatedSignalIds: claim.evidenceNodeIds,
      options: residualOptionsForClaim(claim),
      score: scoreClaimResidual(claim, index),
      rankKey: `${concernPriority[claim.concern]}:${claim.id}:${unknownIndex}`,
    })));
}

function askableClaimResiduals(claim: ArchitectureClaim): string[] {
  if (!shouldAskAboutClaimResidual(claim)) {
    return [];
  }
  return claim.residualUnknowns.filter((unknown) =>
    isFutureIntentText(unknown)
    && !hasCurrentStateInterviewText(unknown)
    && !hasWrongAbstractionLevelText(unknown)
  );
}

function scoreClaimResidual(claim: ArchitectureClaim, index: number): number {
  return concernPriority[claim.concern]
    + 35
    + (isSecurityConcern(claim.concern) ? 20 : 0)
    + (claim.concern === "deployment" ? 18 : 0)
    - index;
}

function isSuppressedByClaim(
  candidate: QuestionCandidate,
  claims: ArchitectureClaim[],
): boolean {
  return claims.some((claim) =>
    claim.concern === candidate.concern
    && suppressesGenericQuestion(claim)
    && (candidate.id.startsWith("question-unknown-") || candidate.id.startsWith("question-fact-"))
  );
}

function shouldAskAboutClaimResidual(claim: ArchitectureClaim): boolean {
  if (claim.residualUnknowns.length === 0) {
    return false;
  }
  if (claim.confidence === "high") {
    return true;
  }
  return isSecurityConcern(claim.concern)
    && claim.confidence === "medium"
    && hasConcreteSecurityEvidence(claim)
    || claim.concern === "deployment"
      && claim.confidence === "medium"
      && hasConcreteDeploymentClaimEvidence(claim);
}

function suppressesGenericQuestion(claim: ArchitectureClaim): boolean {
  if (claim.confidence === "high") {
    return true;
  }
  return isSecurityConcern(claim.concern)
    && claim.confidence === "medium"
    && hasConcreteSecurityEvidence(claim)
    || claim.concern === "deployment"
      && claim.confidence === "medium"
      && hasConcreteDeploymentClaimEvidence(claim);
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
  void input;
  return [];
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
  if (question.id.startsWith("question-claim-")) {
    return {
      ...question,
      interactionGuidance: guidance,
    };
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
      return "Which storage outcome should guide the next architecture move: local-only speed, durable single-user data, collaboration, audit/compliance, or migration safety?";
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
      return "Which access surface should guide the next security review: web sessions, programmatic credentials, external identity, or no authentication work planned?";
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
      return "Which access boundary should the next test or review protect: admin actions, role or membership rules, resource permissions, or no authorization work planned?";
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
      return "Which rollout target should guide this change: local development, private preview, public launch, or production hardening?";
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
      return "Which API stability goal should guide the next architecture move: internal flexibility, stable internal contract, public API, or partner dependency?";
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
      return "Which state ownership risk should guide the next architecture move: component churn, shared client coordination, server authority, or persistent workflow recovery?";
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
      return "Which test gap should the next architecture move close: unit behavior, integration boundary, end-to-end workflow, or release confidence?";
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
      return "Which runtime feedback should the next architecture move improve: logs, metrics, traces, health checks, alerts, or incident review?";
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
      return "Which future storage risk should this evidence influence?";
    case "authentication":
      return "Which future security review should this authentication evidence influence?";
    case "authorization":
      return "Which future access-control risk should this authorization evidence influence?";
    case "deployment":
      return "Which future rollout or operations risk should this deployment evidence influence?";
    case "api_contract":
      return "Which future compatibility risk should this API evidence influence?";
    case "state_ownership":
      return "Which future state ownership risk should this evidence influence?";
    case "risk_hotspot":
      return "Which future risk should this hotspot influence?";
    case "testing":
      return "Which future test investment should this evidence influence?";
    case "observability":
      return "Which future runtime feedback risk should this evidence influence?";
    default:
      return "Which future architecture move should this evidence influence?";
  }
}

function promptForUnknown(unknown: BaselineUnknown): string {
  switch (unknown.concern) {
    case "data_storage":
      return "Which future persistence risk should the coach prioritize?";
    case "authentication":
      return "Which future authentication risk should the coach prioritize?";
    case "authorization":
      return "Which future authorization risk should the coach prioritize?";
    case "deployment":
      return "Which future deployment or sharing risk should the coach prioritize?";
    case "api_contract":
      return "Are any APIs in this project intended to become public or externally depended on?";
    case "state_ownership":
      return "Which future state ownership risk should the coach prioritize?";
    case "testing":
      return "Which future test gap should the coach prioritize?";
    case "observability":
      return "Which future runtime feedback risk should the coach prioritize?";
    default:
      return `Which future architecture risk should the coach prioritize for ${unknown.concern}?`;
  }
}

function promptForSignalFamily(
  family: SignalFamily,
  concern: ArchitectureConcern,
): string {
  switch (family) {
    case "repository":
      return "The repository signal is incomplete. Which future architecture risk should the coach be careful not to miss?";
    case "change":
      return "The change signal is incomplete or conflicting. What part of this change is architecturally important?";
    case "test":
      return "The test signal is incomplete or stale. Which future regression would be most costly to miss?";
    case "memory":
      return "The decision memory signal is incomplete. Are there known shortcuts or prior decisions the coach should respect?";
    case "runtime":
      return "The runtime signal is incomplete or failing. Which future operational failure should the coach prioritize?";
    case "lifecycle":
      return "The host lifecycle signal is incomplete. Which future architecture decision is this work trying to support?";
    default:
      return `Which future architecture risk should the coach prioritize for ${concern}?`;
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
      return ["local-only speed", "durable single-user data", "shared collaboration data", "audit or compliance data", "migration safety"];
    case "authentication":
      return ["web sessions", "programmatic credentials", "external identity", "session hardening", "no authentication work planned"];
    case "authorization":
      return ["admin actions", "role or membership rules", "resource permissions", "API access boundary", "no authorization work planned"];
    case "deployment":
      return ["local development", "private preview", "public launch", "production hardening", "rollback readiness"];
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

function residualPromptForClaim(claim: ArchitectureClaim, unknown: string): string {
  switch (claim.concern) {
    case "authentication":
      return `Authentication evidence is present. ${unknown}`;
    case "authorization":
      return `Authorization evidence is present. ${unknown}`;
    case "data_storage":
      return `Storage evidence is present. ${unknown}`;
    case "deployment":
      return `Deployment evidence is present. ${unknown}`;
    default:
      return `Architecture evidence is present. ${unknown}`;
  }
}

function residualOptionsForClaim(claim: ArchitectureClaim): string[] | undefined {
  switch (claim.concern) {
    case "authentication":
      return ["security review", "test coverage", "credential rotation", "user rollout", "no near-term action"];
    case "authorization":
      return authorizationOptionsForClaim(claim);
    case "data_storage":
      return ["core workflow data", "audit/history data", "cache/session data", "unknown"];
    case "deployment":
      return ["private preview", "public launch", "production hardening", "rollback readiness", "no near-term action"];
    default:
      return undefined;
  }
}

function authorizationOptionsForClaim(claim: ArchitectureClaim): string[] {
  const text = claimText(claim);
  const options: string[] = [];
  if (/(project|user[-_ ]?projects?|membership|member)/.test(text)) {
    options.push("role or membership rules");
  }
  if (/(resource|permission)/.test(text)) {
    options.push("resource-level permissions");
  }
  if (/admin/.test(text)) {
    options.push("admin-only controls");
  }
  if (/(api[-_ ]?key|token|credential)/.test(text)) {
    options.push("API-key access boundary");
  }
  if (/session/.test(text)) {
    options.push("session access boundary");
  }
  return [...new Set([...options, "no near-term action"])];
}

function isAskableUserIntentQuestion(candidate: QuestionCandidate): boolean {
  const text = questionVisibleText(candidate);
  return isFutureIntentText(text)
    && !hasCurrentStateInterviewText(text)
    && !hasWrongAbstractionLevelText(text);
}

function questionVisibleText(candidate: QuestionCandidate): string {
  return [
    candidate.prompt,
    candidate.reason,
    ...(candidate.options ?? []),
  ].join(" ");
}

function isFutureIntentText(text: string): boolean {
  return /\b(next|future|prioriti[sz]e|priority|protect|guide|risk|review|rollout|launch|hardening|planned|plan|obligation|compliance|preserve|investment|costly|decision|action|move|improve|workflow|outcome|support|boundary|compatibility|recovery|regression)\b/i.test(text);
}

function hasCurrentStateInterviewText(text: string): boolean {
  return [
    /should the coach assume/i,
    /what .* assume .*right now/i,
    /what .* should .* assume .*current/i,
    /current project reality/i,
    /current and reliable/i,
    /production[, -]+CLI-only[, -]+or legacy/i,
    /production path.*CLI-only path.*legacy/i,
    /what deployment model should this code assume/i,
    /local-only use, private hosting, public hosting/i,
    /no roles, admin-only controls, role-based access/i,
    /identity boundary should the coach assume/i,
    /test posture should the coach treat as current/i,
    /operational evidence should the coach consider current/i,
    /current work context should the coach assume/i,
  ].some((pattern) => pattern.test(text));
}

function hasWrongAbstractionLevelText(text: string): boolean {
  return [
    /(?:^|\s)[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|jsx|swift|rs|sql|toml|json|yaml|yml|md)\b/i,
    /\b(?:apps|packages|workers|crates|Sources|src|tests|migrations)\/[\w./-]+/i,
    /\b[A-Z][A-Za-z0-9]+(?:Controller|Service|Manager|Store|Editor|Filter|View|Provider|Repository)\b/,
    /\b[a-z][A-Za-z0-9]+(?:Storage|Service|Manager|Repository|Provider)\b/,
  ].some((pattern) => pattern.test(text));
}

function hasConcreteSecurityEvidence(claim: ArchitectureClaim): boolean {
  const text = claimText(claim);
  if (claim.concern === "authorization") {
    return /(membership|member|role|rbac|permission|user[-_ ]?projects?|admin|resource)/.test(text)
      && /(\.test\.|tests?\/|migrations?\/|\.sql|src\/|workers\/|apps\/)/.test(text);
  }
  if (claim.concern === "authentication") {
    return /(oauth|github|session|api[-_ ]?key|token|credential)/.test(text)
      && /(\.test\.|tests?\/|src\/|workers\/|apps\/|scripts\/)/.test(text);
  }
  return false;
}

function hasConcreteDeploymentClaimEvidence(claim: ArchitectureClaim): boolean {
  const text = claimText(claim);
  return /(cloudflare|wrangler|worker|appcast|notari[sz]ation|signing)/.test(text)
    && /(production|staging|local|preview|release)/.test(text)
    && /(wrangler\.toml|\.github\/workflows|scripts\/deploy|docs\/|readme\.md|appcast\.xml)/.test(text);
}

function isSecurityConcern(concern: ArchitectureConcern): boolean {
  return concern === "authentication" || concern === "authorization";
}

function claimText(claim: ArchitectureClaim): string {
  return [
    claim.subject,
    claim.claim,
    ...claim.evidence,
    ...claim.residualUnknowns,
  ].join(" ").toLowerCase();
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
