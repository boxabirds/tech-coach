import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type {
  CoachAction,
  InterventionLevel,
} from "../../kernel/src/protocol.js";
import type { ThresholdCandidate } from "../../kernel/src/baselineTypes.js";
import type { EvidenceCategory } from "../../signals/src/index.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalFamily,
} from "../../kernel/src/telemetryTypes.js";

export type ScenarioExpectation = {
  requiredThresholds: ThresholdCandidate[];
  allowedInterventions: InterventionLevel[];
  expectedActions: CoachAction[];
  forbiddenActions: CoachAction[];
  requiredSignalFamilies: SignalFamily[];
  requiredEvidenceCategories: EvidenceCategory[];
  expectedSilence?: boolean;
};

export type ScenarioMismatchKind =
  | "missing_threshold"
  | "unexpected_intervention"
  | "unexpected_action"
  | "forbidden_action"
  | "missing_signal_family"
  | "missing_evidence_category"
  | "expected_silence";

export type ScenarioMismatch = {
  kind: ScenarioMismatchKind;
  message: string;
  expected?: string;
  actual?: string;
};

export function assertScenarioExpectation(input: {
  result: AssessmentResult;
  expectation: ScenarioExpectation;
  telemetry?: ArchitecturalTelemetryBundle;
}): ScenarioMismatch[] {
  return [
    ...assertThresholds(input.result, input.expectation),
    ...assertIntervention(input.result, input.expectation),
    ...assertActions(input.result, input.expectation),
    ...assertSignalFamilies(input.result, input.expectation, input.telemetry),
    ...assertEvidenceCategories(input.result, input.expectation),
    ...assertExpectedSilence(input.result, input.expectation),
  ];
}

export function collectThresholds(result: AssessmentResult): Set<string> {
  return new Set(
    result.baseline.concerns.flatMap((concern) => concern.thresholdCandidates),
  );
}

export function collectEvidenceCategories(result: AssessmentResult): Set<string> {
  return new Set(
    result.evidence
      .map((evidence) => evidence.category)
      .filter((category): category is string => typeof category === "string"),
  );
}

export function collectSignalFamilies(
  result: AssessmentResult,
  telemetry?: ArchitecturalTelemetryBundle,
): Set<string> {
  const families = new Set(
    result.evidence
      .map((evidence) => evidence.family)
      .filter((family): family is string => typeof family === "string"),
  );

  if (!telemetry) {
    return families;
  }

  for (const family of signalFamilies) {
    if (telemetry[family].some((signal) => signal.status === "present")) {
      families.add(family);
    }
  }

  return families;
}

function assertThresholds(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
): ScenarioMismatch[] {
  const actual = collectThresholds(result);
  return expectation.requiredThresholds
    .filter((threshold) => !actual.has(threshold))
    .map((threshold) => ({
      kind: "missing_threshold",
      expected: threshold,
      actual: Array.from(actual).join(", "),
      message: `Expected threshold ${threshold} was not present.`,
    }));
}

function assertIntervention(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
): ScenarioMismatch[] {
  if (expectation.allowedInterventions.includes(result.intervention)) {
    return [];
  }
  return [{
    kind: "unexpected_intervention",
    expected: expectation.allowedInterventions.join(", "),
    actual: result.intervention,
    message: `Intervention ${result.intervention} was outside the allowed range.`,
  }];
}

function assertActions(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
): ScenarioMismatch[] {
  const mismatches: ScenarioMismatch[] = [];
  if (!expectation.expectedActions.includes(result.action)) {
    mismatches.push({
      kind: "unexpected_action",
      expected: expectation.expectedActions.join(", "),
      actual: result.action,
      message: `Action ${result.action} was not expected.`,
    });
  }
  if (expectation.forbiddenActions.includes(result.action)) {
    mismatches.push({
      kind: "forbidden_action",
      expected: `not ${result.action}`,
      actual: result.action,
      message: `Forbidden action ${result.action} was recommended.`,
    });
  }
  return mismatches;
}

function assertSignalFamilies(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
  telemetry: ArchitecturalTelemetryBundle | undefined,
): ScenarioMismatch[] {
  const actual = collectSignalFamilies(result, telemetry);
  return expectation.requiredSignalFamilies
    .filter((family) => !actual.has(family))
    .map((family) => ({
      kind: "missing_signal_family",
      expected: family,
      actual: Array.from(actual).join(", "),
      message: `Required signal family ${family} was not cited or present.`,
    }));
}

function assertEvidenceCategories(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
): ScenarioMismatch[] {
  const actual = collectEvidenceCategories(result);
  return expectation.requiredEvidenceCategories
    .filter((category) => !actual.has(category))
    .map((category) => ({
      kind: "missing_evidence_category",
      expected: category,
      actual: Array.from(actual).join(", "),
      message: `Required evidence category ${category} was not cited.`,
    }));
}

function assertExpectedSilence(
  result: AssessmentResult,
  expectation: ScenarioExpectation,
): ScenarioMismatch[] {
  if (!expectation.expectedSilence) {
    return [];
  }
  if (
    result.status === "ok"
    && result.action === "Continue"
    && result.questions.length === 0
    && result.revisitAlerts.length === 0
  ) {
    return [];
  }
  return [{
    kind: "expected_silence",
    expected: "ok Continue with no questions or revisit alerts",
    actual: `${result.status} ${result.action}`,
    message: "Scenario expected no visible architecture intervention.",
  }];
}

const signalFamilies: SignalFamily[] = [
  "lifecycle",
  "repository",
  "change",
  "test",
  "memory",
  "runtime",
];
