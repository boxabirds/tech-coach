import type { AssessmentEvidence, AssessmentResult } from "./assessment.js";
import type {
  ArchitectureBaseline,
  ArchitectureConcern,
  BaselineQuestion,
  DecisionAxisAssessment,
  ThresholdCandidate,
} from "./baselineTypes.js";
import type {
  CoachAction,
  InterventionLevel,
} from "./protocol.js";
import type { RevisitAlert } from "./revisit.js";
import type {
  ArchitecturePrincipleId,
  PrincipleGuidance,
  StructuralPatternId,
} from "./principleTypes.js";

export type StableQuestionProjection = Pick<
  BaselineQuestion,
  "id" | "concern" | "kind" | "prompt" | "reason"
> & {
  relatedFactIds: string[];
  relatedUnknownIds: string[];
  relatedSignalIds: string[];
  options: string[];
};

export type StableEvidenceProjection = Required<
  Pick<AssessmentEvidence, "family" | "source" | "category" | "summary">
>;

export type StableGuidanceProjection = {
  status: AssessmentResult["status"];
  intervention: AssessmentResult["intervention"];
  action: AssessmentResult["action"];
  reason: string;
  memory: AssessmentResult["memory"];
  evidence: StableEvidenceProjection[];
  questions: StableQuestionProjection[];
  concerns: Array<{
    concern: string;
    currentState: string;
    confidence: string;
    rationale: string;
  }>;
};

export type StableAnswerSemanticsProjection = {
  confirmations: Array<{
    factId: string;
    questionId: string;
    status: string;
    value: string;
    note: string;
  }>;
  diagnostics: Array<{
    severity: string;
    source: string;
    message: string;
  }>;
  facts: Array<{
    id: string;
    concern: string;
    status: string;
    confidence: string;
    summary: string;
  }>;
};

export type ConcernPolicyState = {
  concern: ArchitectureConcern;
  maturity: string;
  confidence: string;
  thresholds: ThresholdCandidate[];
  axes: DecisionAxisAssessment;
  principleIds: ArchitecturePrincipleId[];
  patternIds: StructuralPatternId[];
  evidenceStrength: "none" | "weak" | "supported" | "strong";
};

export type SelectedPolicyAction = {
  concern?: ArchitectureConcern;
  action: CoachAction;
  intervention: InterventionLevel;
  reason: string;
  thresholdCandidates: ThresholdCandidate[];
  axes: DecisionAxisAssessment;
  principleIds: ArchitecturePrincipleId[];
  patternId?: StructuralPatternId;
  contract?: {
    owner: string;
    dependents: string;
    exclusions: string;
    tests: string;
    provisional?: string;
  };
  doNotAdd: string[];
  provisional: boolean;
  requiresQuestion: boolean;
};

export type ArchitecturePolicyDecision = {
  concerns: ConcernPolicyState[];
  selected: SelectedPolicyAction;
};

export function selectArchitecturePolicy(input: {
  baseline: ArchitectureBaseline;
  questions: BaselineQuestion[];
  revisitAlerts: RevisitAlert[];
  principleGuidance: PrincipleGuidance[];
}): ArchitecturePolicyDecision {
  const concerns = input.baseline.concerns.map((concern): ConcernPolicyState => {
    const guidance = input.principleGuidance.find((item) => item.concern === concern.concern);
    return {
      concern: concern.concern,
      maturity: concern.currentState,
      confidence: concern.confidence,
      thresholds: [...concern.thresholdCandidates].sort(),
      axes: concern.axes,
      principleIds: Array.from(new Set(
        guidance?.principles.map((principle) => principle.id) ?? [],
      )).sort(),
      patternIds: Array.from(new Set(
        guidance?.patterns.map((pattern) => pattern.pattern) ?? [],
      )).sort(),
      evidenceStrength: evidenceStrengthFor(concern.confidence, concern.facts.length),
    };
  }).sort((left, right) => left.concern.localeCompare(right.concern));

  const selected = selectPolicyAction(input);
  return { concerns, selected };
}

export function projectStableGuidance(
  result: AssessmentResult,
): StableGuidanceProjection {
  return {
    status: result.status,
    intervention: result.intervention,
    action: result.action,
    reason: result.reason,
    memory: result.memory,
    evidence: result.evidence.map(projectEvidence).sort(compareJson),
    questions: result.questions.map(projectQuestion).sort(compareJson),
    concerns: result.baseline.concerns
      .map((concern) => ({
        concern: concern.concern,
        currentState: concern.currentState,
        confidence: concern.confidence,
        rationale: concern.rationale,
      }))
      .sort(compareJson),
  };
}

function selectPolicyAction(input: {
  baseline: ArchitectureBaseline;
  questions: BaselineQuestion[];
  revisitAlerts: RevisitAlert[];
  principleGuidance: PrincipleGuidance[];
}): SelectedPolicyAction {
  if (input.revisitAlerts.length > 0) {
    const alert = input.revisitAlerts[0];
    const concern = concernForAlert(input.baseline, alert);
    return selectedAction({
      concern,
      action: alert.recommendedAction,
      intervention: "decision-required",
      reason: `Prior decision ${alert.decisionId} matched revisit condition "${alert.matchedCondition}".`,
      baseline: input.baseline,
      guidance: input.principleGuidance.find((item) => item.concern === concern),
      requiresQuestion: input.questions.length > 0,
    });
  }

  const risk = concernBy(input.baseline, "risk_hotspot", (concern) =>
    concern.thresholdCandidates.includes("blast_radius")
    && hasExplicitRiskSource(concern)
  );
  if (risk) {
    return selectedAction({
      concern: risk.concern,
      action: "Run review",
      intervention: risk.confidence === "high" ? "block" : "recommend",
      reason: "Current evidence shows broad change or risk hotspot pressure.",
      baseline: input.baseline,
      guidance: input.principleGuidance.find((item) => item.concern === risk.concern),
      requiresQuestion: input.questions.some((question) => question.concern === risk.concern),
      provisional: risk.confidence === "low",
    });
  }

  const packageBoundary = concernBy(input.baseline, "package_boundary", (concern) =>
    concern.facts.length > 0 && concern.confidence !== "low"
  );
  if (packageBoundary) {
    return selectedAction({
      concern: packageBoundary.concern,
      action: "Add test harness",
      intervention: "recommend",
      reason: "Repository shape shows a runtime or package boundary that can be protected locally while open assumptions remain visible.",
      baseline: input.baseline,
      guidance: input.principleGuidance.find((item) => item.concern === packageBoundary.concern),
      requiresQuestion: input.questions.some((question) => question.concern === packageBoundary.concern),
    });
  }

  const highValuePattern = firstHighValuePattern(input.principleGuidance);
  if (highValuePattern) {
    return selectedAction({
      concern: highValuePattern.concern,
      action: actionForPattern(highValuePattern.patternId),
      intervention: interventionForConcern(input.baseline, highValuePattern.concern, input.questions),
      reason: reasonForPattern(highValuePattern.patternId, highValuePattern.concern),
      baseline: input.baseline,
      guidance: highValuePattern.guidance,
      requiresQuestion: input.questions.some((question) => question.concern === highValuePattern.concern),
      patternId: highValuePattern.patternId,
      provisional: highValuePattern.confidence === "low",
    });
  }

  if (input.questions.length > 0) {
    return selectedAction({
      concern: input.questions[0].concern,
      action: "Record decision",
      intervention: highRiskConcern(input.questions[0].concern)
        ? "interview-required"
        : "recommend",
      reason: `Baseline has ${input.questions.length} high-impact unconfirmed assumption${input.questions.length === 1 ? "" : "s"}.`,
      baseline: input.baseline,
      guidance: input.principleGuidance.find((item) => item.concern === input.questions[0].concern),
      requiresQuestion: true,
    });
  }

  const loadBearing = input.baseline.concerns.find((concern) =>
    concern.currentState === "LoadBearing" || concern.currentState === "Revisit"
  );
  if (loadBearing) {
    return selectedAction({
      concern: loadBearing.concern,
      action: actionForConcern(loadBearing.concern),
      intervention: "recommend",
      reason: `${loadBearing.concern} appears ${loadBearing.currentState}.`,
      baseline: input.baseline,
      guidance: input.principleGuidance.find((item) => item.concern === loadBearing.concern),
    });
  }

  if (input.baseline.facts.length === 0) {
    return selectedAction({
      action: "Continue",
      intervention: "note",
      reason: "No concrete architecture evidence or prior decisions were available.",
      baseline: input.baseline,
      doNotAdd: ["Do not add durable architecture structure until there is concrete project evidence."],
    });
  }

  return selectedAction({
    action: "Continue",
    intervention: "note",
    reason: "Current evidence does not require adding structure yet.",
    baseline: input.baseline,
    doNotAdd: ["Do not introduce new boundaries, storage, auth, or deployment machinery without a matching threshold signal."],
  });
}

function selectedAction(input: {
  concern?: ArchitectureConcern;
  action: CoachAction;
  intervention: InterventionLevel;
  reason: string;
  baseline: ArchitectureBaseline;
  guidance?: PrincipleGuidance;
  requiresQuestion?: boolean;
  patternId?: StructuralPatternId;
  provisional?: boolean;
  doNotAdd?: string[];
}): SelectedPolicyAction {
  const concern = input.concern
    ? input.baseline.concerns.find((item) => item.concern === input.concern)
    : undefined;
  const pattern = input.patternId
    ? input.guidance?.patterns.find((item) => item.pattern === input.patternId)
    : input.guidance?.patterns[0];
  return {
    ...(input.concern ? { concern: input.concern } : {}),
    action: input.action,
    intervention: input.intervention,
    reason: input.reason,
    thresholdCandidates: [...(concern?.thresholdCandidates ?? [])].sort(),
    axes: concern?.axes ?? {
      complexity: "unknown",
      irreversibility: "unknown",
      planningHorizon: "unknown",
      solutionVisibility: "unknown",
    },
    principleIds: Array.from(new Set(input.guidance?.principles.map((principle) => principle.id) ?? [])).sort(),
    ...(pattern ? { patternId: pattern.pattern } : {}),
    ...(input.guidance?.contract ? { contract: input.guidance.contract } : {}),
    doNotAdd: input.doNotAdd ?? [pattern?.doNotAddYet].filter((item): item is string => Boolean(item)),
    provisional: input.provisional === true || pattern?.confidence === "low",
    requiresQuestion: input.requiresQuestion === true,
  };
}

function firstHighValuePattern(
  guidance: PrincipleGuidance[],
): {
  concern: ArchitectureConcern;
  patternId: StructuralPatternId;
  confidence: string;
  guidance: PrincipleGuidance;
} | undefined {
  const candidates = guidance.flatMap((item) =>
    item.patterns.map((pattern) => ({
      concern: item.concern,
      patternId: pattern.pattern,
      confidence: pattern.confidence,
      guidance: item,
      score: patternScore(pattern.pattern, item.concern, pattern.confidence),
    }))
  ).filter((item) => item.patternId !== "continue_locally");
  return candidates.sort((left, right) =>
    right.score - left.score || left.concern.localeCompare(right.concern)
  )[0];
}

function patternScore(
  pattern: StructuralPatternId,
  concern: ArchitectureConcern,
  confidence: string,
): number {
  const base = (() => {
    switch (pattern) {
      case "add_targeted_test_harness":
        return concern === "package_boundary" ? 95 : 55;
      case "run_security_review":
        return 88;
      case "operationalize_runtime":
        return 82;
      case "extract_custom_hook":
        return 90;
      case "insert_repository_boundary":
        return 85;
      case "record_api_contract":
        return 80;
      case "name_state_owner":
        return 65;
      case "continue_locally":
        return 0;
    }
  })();
  return base + (confidence === "high" ? 10 : confidence === "medium" ? 5 : -25);
}

function actionForPattern(pattern: StructuralPatternId): CoachAction {
  switch (pattern) {
    case "extract_custom_hook":
      return "Extract";
    case "name_state_owner":
      return "Name";
    case "insert_repository_boundary":
    case "record_api_contract":
      return "Insert boundary";
    case "add_targeted_test_harness":
      return "Add test harness";
    case "run_security_review":
      return "Run review";
    case "operationalize_runtime":
      return "Operationalize";
    case "continue_locally":
      return "Continue";
  }
}

function reasonForPattern(
  pattern: StructuralPatternId,
  concern: ArchitectureConcern,
): string {
  switch (pattern) {
    case "extract_custom_hook":
      return "State ownership evidence crosses the mixed rendering/effects threshold; extract the smallest local owner.";
    case "name_state_owner":
      return "State ownership evidence is present but not strong enough for a larger abstraction; name the owner first.";
    case "insert_repository_boundary":
      return "Persistence evidence justifies a named boundary before replacing the storage substrate.";
    case "record_api_contract":
      return "API evidence justifies recording the contract callers can depend on.";
    case "add_targeted_test_harness":
      return `${concern} evidence is mature enough to protect with a focused test harness.`;
    case "run_security_review":
      return "Identity or authorization evidence crosses the security threshold; review the access boundary before relying on it.";
    case "operationalize_runtime":
      return "Deployment or runtime evidence crosses the operational threshold; add the smallest operational contract.";
    case "continue_locally":
      return "No durable structure is justified yet.";
  }
}

function interventionForConcern(
  baseline: ArchitectureBaseline,
  concern: ArchitectureConcern,
  questions: BaselineQuestion[],
): InterventionLevel {
  const assessment = baseline.concerns.find((item) => item.concern === concern);
  const hasQuestion = questions.some((question) => question.concern === concern);
  if (!assessment) {
    return hasQuestion ? "interview-required" : "recommend";
  }
  if (hasQuestion && highRiskConcern(concern)) {
    return "interview-required";
  }
  if (
    assessment.confidence === "high"
    && (
      assessment.thresholdCandidates.includes("security")
      || assessment.thresholdCandidates.includes("deployment")
      || assessment.thresholdCandidates.includes("public_api")
    )
  ) {
    return "decision-required";
  }
  return "recommend";
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
    case "deployment":
    case "observability":
      return "Operationalize";
    default:
      return "Record decision";
  }
}

function concernBy(
  baseline: ArchitectureBaseline,
  concern: ArchitectureConcern,
  predicate: (concern: ArchitectureBaseline["concerns"][number]) => boolean,
): ArchitectureBaseline["concerns"][number] | undefined {
  return baseline.concerns.find((item) => item.concern === concern && predicate(item));
}

function concernForAlert(
  baseline: ArchitectureBaseline,
  alert: RevisitAlert,
): ArchitectureConcern | undefined {
  const mapped = concernForDecisionText(alert.concern);
  if (baseline.concerns.some((concern) => concern.concern === mapped)) {
    return mapped;
  }
  return baseline.concerns.find((concern) =>
    concern.thresholdCandidates.includes("revisit")
  )?.concern;
}

function hasExplicitRiskSource(concern: ArchitectureBaseline["concerns"][number]): boolean {
  return concern.facts.some((fact) =>
    fact.sources.some((source) =>
      source.category === "changed_file_spread" || source.category === "diagnostic"
    )
  );
}

function concernForDecisionText(value: string): ArchitectureConcern {
  const normalized = value.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("identity") || normalized.includes("login")) {
    return "authentication";
  }
  if (normalized.includes("permission") || normalized.includes("role") || normalized.includes("access")) {
    return "authorization";
  }
  if (
    normalized.includes("storage")
    || normalized.includes("persistence")
    || normalized.includes("database")
  ) {
    return "data_storage";
  }
  if (normalized.includes("api") || normalized.includes("contract")) {
    return "api_contract";
  }
  if (normalized.includes("deploy") || normalized.includes("hosting")) {
    return "deployment";
  }
  if (normalized.includes("state") || normalized.includes("ownership")) {
    return "state_ownership";
  }
  return "unknown";
}

function highRiskConcern(concern: ArchitectureConcern): boolean {
  return [
    "data_storage",
    "authentication",
    "authorization",
    "deployment",
    "api_contract",
    "risk_hotspot",
  ].includes(concern);
}

function evidenceStrengthFor(
  confidence: string,
  factCount: number,
): ConcernPolicyState["evidenceStrength"] {
  if (factCount === 0) {
    return "none";
  }
  if (confidence === "high") {
    return "strong";
  }
  if (confidence === "medium") {
    return "supported";
  }
  return "weak";
}

export function projectAnswerSemantics(
  baseline: ArchitectureBaseline,
): StableAnswerSemanticsProjection {
  return {
    confirmations: (baseline.confirmations ?? [])
      .map((confirmation) => ({
        factId: confirmation.factId,
        questionId: confirmation.questionId,
        status: confirmation.status,
        value: confirmation.value ?? "",
        note: confirmation.note ?? "",
      }))
      .sort(compareJson),
    diagnostics: baseline.diagnostics
      .map((diagnostic) => ({
        severity: diagnostic.severity,
        source: diagnostic.source ?? "",
        message: diagnostic.message,
      }))
      .sort(compareJson),
    facts: baseline.facts
      .map((fact) => ({
        id: fact.id,
        concern: fact.concern,
        status: fact.status,
        confidence: fact.confidence,
        summary: fact.summary,
      }))
      .sort(compareJson),
  };
}

function projectEvidence(evidence: AssessmentEvidence): StableEvidenceProjection {
  return {
    family: evidence.family ?? "",
    source: evidence.source,
    category: evidence.category ?? "",
    summary: evidence.summary,
  };
}

function projectQuestion(question: BaselineQuestion): StableQuestionProjection {
  return {
    id: question.id,
    concern: question.concern,
    kind: question.kind,
    prompt: question.prompt,
    reason: question.reason,
    relatedFactIds: [...question.relatedFactIds].sort(),
    relatedUnknownIds: [...question.relatedUnknownIds].sort(),
    relatedSignalIds: [...question.relatedSignalIds].sort(),
    options: [...(question.options ?? [])].sort(),
  };
}

function compareJson(a: unknown, b: unknown): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
