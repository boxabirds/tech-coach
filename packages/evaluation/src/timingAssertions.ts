import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type {
  CoachAction,
  InterventionLevel,
  MaturityState,
} from "../../kernel/src/protocol.js";
import type {
  ArchitectureBaseline,
  ArchitectureConcern,
  BaselineQuestion,
} from "../../kernel/src/baselineTypes.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalFamily,
} from "../../kernel/src/telemetryTypes.js";

export type TurnExpectation = {
  expectedIntervention: InterventionLevel;
  expectedAction?: CoachAction;
  expectedConcern?: ArchitectureConcern;
  expectedFromState?: MaturityState;
  expectedToState?: MaturityState;
  expectedInterview?: boolean;
  expectedResolvedQuestionIds?: string[];
  requiredSignalFamilies?: SignalFamily[];
};

export type TimingMismatchKind =
  | "unexpected_intervention"
  | "unexpected_action"
  | "unexpected_from_state"
  | "unexpected_to_state"
  | "missing_concern"
  | "missing_interview"
  | "unexpected_interview"
  | "missing_answer"
  | "invalid_answer"
  | "missing_signal_family"
  | "missing_correlation";

export type TimingMismatch = {
  kind: TimingMismatchKind;
  message: string;
  expected?: string;
  actual?: string;
};

export function assertTurnTiming(input: {
  assessment: AssessmentResult;
  expectation: TurnExpectation;
  telemetry: ArchitecturalTelemetryBundle;
  priorAssessment?: AssessmentResult;
  answeredBaseline?: ArchitectureBaseline;
  correlationId?: string;
}): TimingMismatch[] {
  return [
    ...assertIntervention(input.assessment, input.expectation),
    ...assertAction(input.assessment, input.expectation),
    ...assertConcernStates(input.assessment, input.expectation, input.priorAssessment),
    ...assertInterview(input.assessment.questions, input.expectation),
    ...assertAppliedAnswers(input.answeredBaseline, input.expectation),
    ...assertSignalFamilies(input.telemetry, input.expectation),
    ...assertCorrelation(input.telemetry, input.correlationId),
    ...assertAnswerDiagnostics(input.answeredBaseline),
  ];
}

export function visibleIntervention(result: AssessmentResult): InterventionLevel {
  if (
    result.status === "ok"
    && result.action === "Continue"
    && result.questions.length === 0
    && result.revisitAlerts.length === 0
  ) {
    return "silent";
  }
  return result.intervention;
}

export function presentSignalFamilies(
  telemetry: ArchitecturalTelemetryBundle,
): Set<SignalFamily> {
  const families = new Set<SignalFamily>();
  for (const family of signalFamilies) {
    if (telemetry[family].some((signal) => signal.status === "present")) {
      families.add(family);
    }
  }
  return families;
}

function assertIntervention(
  result: AssessmentResult,
  expectation: TurnExpectation,
): TimingMismatch[] {
  const actual = visibleIntervention(result);
  if (actual === expectation.expectedIntervention) {
    return [];
  }
  return [{
    kind: "unexpected_intervention",
    expected: expectation.expectedIntervention,
    actual,
    message: `Expected ${expectation.expectedIntervention} intervention but got ${actual}.`,
  }];
}

function assertAction(
  result: AssessmentResult,
  expectation: TurnExpectation,
): TimingMismatch[] {
  if (!expectation.expectedAction || result.action === expectation.expectedAction) {
    return [];
  }
  return [{
    kind: "unexpected_action",
    expected: expectation.expectedAction,
    actual: result.action,
    message: `Expected action ${expectation.expectedAction} but got ${result.action}.`,
  }];
}

function assertConcernStates(
  result: AssessmentResult,
  expectation: TurnExpectation,
  prior: AssessmentResult | undefined,
): TimingMismatch[] {
  if (!expectation.expectedConcern) {
    return [];
  }

  const mismatches: TimingMismatch[] = [];
  const currentConcern = result.baseline.concerns.find(
    (concern) => concern.concern === expectation.expectedConcern,
  );
  if (!currentConcern) {
    return [{
      kind: "missing_concern",
      expected: expectation.expectedConcern,
      message: `Expected concern ${expectation.expectedConcern} was not present.`,
    }];
  }

  if (expectation.expectedToState && currentConcern.currentState !== expectation.expectedToState) {
    mismatches.push({
      kind: "unexpected_to_state",
      expected: expectation.expectedToState,
      actual: currentConcern.currentState,
      message: `Expected ${expectation.expectedConcern} to move to ${expectation.expectedToState}.`,
    });
  }

  if (expectation.expectedFromState) {
    const priorState = prior?.baseline.concerns.find(
      (concern) => concern.concern === expectation.expectedConcern,
    )?.currentState;
    const actual = priorState ?? "none";
    if (actual !== expectation.expectedFromState) {
      mismatches.push({
        kind: "unexpected_from_state",
        expected: expectation.expectedFromState,
        actual,
        message: `Expected ${expectation.expectedConcern} to start from ${expectation.expectedFromState}.`,
      });
    }
  }

  return mismatches;
}

function assertInterview(
  questions: BaselineQuestion[],
  expectation: TurnExpectation,
): TimingMismatch[] {
  if (expectation.expectedInterview === undefined) {
    return [];
  }
  if (expectation.expectedInterview && questions.length === 0) {
    return [{
      kind: "missing_interview",
      expected: "questions",
      actual: "none",
      message: "Expected host-mediated interview questions.",
    }];
  }
  if (!expectation.expectedInterview && questions.length > 0) {
    return [{
      kind: "unexpected_interview",
      expected: "no questions",
      actual: questions.map((question) => question.id).join(", "),
      message: "Expected no host-mediated interview questions.",
    }];
  }
  return [];
}

function assertAppliedAnswers(
  answeredBaseline: ArchitectureBaseline | undefined,
  expectation: TurnExpectation,
): TimingMismatch[] {
  const required = expectation.expectedResolvedQuestionIds ?? [];
  if (required.length === 0) {
    return [];
  }
  const resolved = new Set(
    answeredBaseline?.confirmations
      ?.filter((confirmation) => confirmation.status !== "unresolved")
      .map((confirmation) => confirmation.questionId) ?? [],
  );

  return required
    .filter((questionId) => !resolved.has(questionId))
    .map((questionId) => ({
      kind: "missing_answer",
      expected: questionId,
      actual: Array.from(resolved).join(", "),
      message: `Expected question ${questionId} to be resolved by a host answer.`,
    }));
}

function assertSignalFamilies(
  telemetry: ArchitecturalTelemetryBundle,
  expectation: TurnExpectation,
): TimingMismatch[] {
  const required = expectation.requiredSignalFamilies ?? [];
  const actual = presentSignalFamilies(telemetry);
  return required
    .filter((family) => !actual.has(family))
    .map((family) => ({
      kind: "missing_signal_family",
      expected: family,
      actual: Array.from(actual).join(", "),
      message: `Expected present ${family} signal family.`,
    }));
}

function assertCorrelation(
  telemetry: ArchitecturalTelemetryBundle,
  correlationId: string | undefined,
): TimingMismatch[] {
  if (!correlationId) {
    return [{
      kind: "missing_correlation",
      message: "Turn is missing a correlation id.",
    }];
  }

  const uncorrelated = signalFamilies.flatMap((family) =>
    telemetry[family]
      .filter((signal) => signal.status === "present")
      .filter((signal) => signal.correlationId !== correlationId)
      .map((signal) => signal.id)
  );
  if (uncorrelated.length === 0) {
    return [];
  }
  return [{
    kind: "missing_correlation",
    expected: correlationId,
    actual: uncorrelated.join(", "),
    message: "Present telemetry signals must share the turn correlation id.",
  }];
}

function assertAnswerDiagnostics(
  answeredBaseline: ArchitectureBaseline | undefined,
): TimingMismatch[] {
  const errors = answeredBaseline?.diagnostics.filter(
    (diagnostic) => diagnostic.source === "baselineMerge" && diagnostic.severity === "error",
  ) ?? [];
  return errors.map((diagnostic) => ({
    kind: "invalid_answer",
    actual: diagnostic.id,
    message: diagnostic.message,
  }));
}

const signalFamilies: SignalFamily[] = [
  "lifecycle",
  "repository",
  "change",
  "test",
  "memory",
  "runtime",
];
