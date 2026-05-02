import type { ScenarioMismatch } from "./assertions.js";
import type { TimingMismatch } from "./timingAssertions.js";
import type { ClaimComparisonFailure } from "./claimComparator.js";

export type EvaluationFailureCategory =
  | "fixture_contract_failure"
  | "extraction_failure"
  | "policy_failure"
  | "interview_failure"
  | "memory_failure"
  | "host_rendering_failure";

export type ClassifiedFailure = {
  category: EvaluationFailureCategory;
  kind: string;
  message: string;
  expected?: string;
  actual?: string;
};

export function classifyScenarioMismatch(
  mismatch: ScenarioMismatch,
): ClassifiedFailure {
  return {
    category: scenarioCategoryFor(mismatch.kind),
    kind: mismatch.kind,
    message: mismatch.message,
    ...(mismatch.expected ? { expected: mismatch.expected } : {}),
    ...(mismatch.actual ? { actual: mismatch.actual } : {}),
  };
}

export function classifyTimingMismatch(
  mismatch: TimingMismatch,
): ClassifiedFailure {
  return {
    category: timingCategoryFor(mismatch.kind),
    kind: mismatch.kind,
    message: mismatch.message,
    ...(mismatch.expected ? { expected: mismatch.expected } : {}),
    ...(mismatch.actual ? { actual: mismatch.actual } : {}),
  };
}

export function classifyClaimFailure(
  failure: ClaimComparisonFailure,
): ClassifiedFailure {
  return {
    category: claimCategoryFor(failure.category),
    kind: failure.category,
    message: failure.message,
  };
}

export function summarizeFailures(
  failures: ClassifiedFailure[],
): Record<EvaluationFailureCategory, number> {
  const summary: Record<EvaluationFailureCategory, number> = {
    fixture_contract_failure: 0,
    extraction_failure: 0,
    policy_failure: 0,
    interview_failure: 0,
    memory_failure: 0,
    host_rendering_failure: 0,
  };
  for (const failure of failures) {
    summary[failure.category] += 1;
  }
  return summary;
}

function scenarioCategoryFor(
  kind: ScenarioMismatch["kind"],
): EvaluationFailureCategory {
  switch (kind) {
    case "missing_signal_family":
    case "missing_evidence_category":
      return "extraction_failure";
    case "missing_threshold":
    case "unexpected_intervention":
    case "unexpected_action":
    case "forbidden_action":
    case "expected_silence":
      return "policy_failure";
  }
}

function timingCategoryFor(
  kind: TimingMismatch["kind"],
): EvaluationFailureCategory {
  switch (kind) {
    case "missing_signal_family":
      return "extraction_failure";
    case "missing_interview":
    case "unexpected_interview":
    case "missing_answer":
    case "invalid_answer":
      return "interview_failure";
    case "missing_correlation":
      return "host_rendering_failure";
    case "unexpected_intervention":
    case "unexpected_action":
    case "unexpected_from_state":
    case "unexpected_to_state":
    case "missing_concern":
      return "policy_failure";
  }
}

function claimCategoryFor(
  kind: ClaimComparisonFailure["category"],
): EvaluationFailureCategory {
  switch (kind) {
    case "missing_claim":
    case "missing_evidence":
    case "missing_fact":
    case "forbidden_evidence":
    case "artifact_missing":
      return "extraction_failure";
    case "missing_question":
    case "forbidden_question":
      return "interview_failure";
  }
}
