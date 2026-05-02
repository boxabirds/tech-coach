import type { ScenarioResult, ScenarioSuiteResult } from "./runner.js";
import type { JourneyResult, JourneyTurnResult } from "./journeyRunner.js";
import type { ClaimComparisonResult } from "./claimComparator.js";
import {
  classifyClaimFailure,
  classifyScenarioMismatch,
  classifyTimingMismatch,
  summarizeFailures,
  type ClassifiedFailure,
} from "./failureClassification.js";

export type EvaluationLayer =
  | "fixture_judgment"
  | "multi_turn_journey"
  | "real_repo_regression";

export type EvaluationReportItem = {
  layer: EvaluationLayer;
  name: string;
  passed: boolean;
  failures: ClassifiedFailure[];
};

export type EvaluationReport = {
  passed: boolean;
  items: EvaluationReportItem[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: ReturnType<typeof summarizeFailures>;
  };
};

export function reportScenarioSuite(
  suite: ScenarioSuiteResult,
): EvaluationReport {
  return buildReport(suite.results.map(reportScenarioResult));
}

export function reportJourneys(
  journeys: JourneyResult[],
): EvaluationReport {
  return buildReport(journeys.map(reportJourneyResult));
}

export function reportRealRepoClaims(
  results: ClaimComparisonResult[],
): EvaluationReport {
  return buildReport(results.map(reportClaimResult));
}

export function buildReport(items: EvaluationReportItem[]): EvaluationReport {
  const failures = items.flatMap((item) => item.failures);
  const passed = items.filter((item) => item.passed).length;
  return {
    passed: failures.length === 0 && passed === items.length,
    items,
    summary: {
      total: items.length,
      passed,
      failed: items.length - passed,
      byCategory: summarizeFailures(failures),
    },
  };
}

function reportScenarioResult(result: ScenarioResult): EvaluationReportItem {
  const failures = [
    ...result.diagnostics.map((diagnostic): ClassifiedFailure => ({
      category: "fixture_contract_failure",
      kind: diagnostic.field,
      message: diagnostic.message,
    })),
    ...result.mismatches.map(classifyScenarioMismatch),
  ];
  return {
    layer: "fixture_judgment",
    name: result.name,
    passed: result.passed,
    failures,
  };
}

function reportJourneyResult(result: JourneyResult): EvaluationReportItem {
  const failures = [
    ...result.diagnostics.map((diagnostic): ClassifiedFailure => ({
      category: "fixture_contract_failure",
      kind: diagnostic.field,
      message: diagnostic.message,
    })),
    ...result.turns.flatMap((turn) => failuresForTurn(turn)),
  ];
  return {
    layer: "multi_turn_journey",
    name: result.name,
    passed: result.passed,
    failures,
  };
}

function failuresForTurn(turn: JourneyTurnResult): ClassifiedFailure[] {
  return [
    ...turn.diagnostics.map((diagnostic): ClassifiedFailure => ({
      category: "fixture_contract_failure",
      kind: diagnostic.field,
      message: diagnostic.message,
    })),
    ...turn.mismatches.map((mismatch) => ({
      ...classifyTimingMismatch(mismatch),
      message: `turn ${turn.turn}: ${mismatch.message}`,
    })),
  ];
}

function reportClaimResult(result: ClaimComparisonResult): EvaluationReportItem {
  const failures = result.failures.map(classifyClaimFailure);
  return {
    layer: "real_repo_regression",
    name: result.repository,
    passed: result.passed,
    failures,
  };
}
