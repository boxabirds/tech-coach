import {
  assessArchitecture,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { DecisionRecord } from "../../kernel/src/memory.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import {
  assertScenarioExpectation,
  type ScenarioExpectation,
  type ScenarioMismatch,
} from "./assertions.js";

export type ScenarioFixture = {
  name: string;
  event: CoachEventEnvelope;
  telemetry?: ArchitecturalTelemetryBundle;
  memory: DecisionRecord[];
  expectation: ScenarioExpectation;
};

export type ScenarioDiagnostic = {
  field: string;
  message: string;
};

export type ScenarioResult = {
  name: string;
  passed: boolean;
  diagnostics: ScenarioDiagnostic[];
  mismatches: ScenarioMismatch[];
  assessment?: AssessmentResult;
};

export type ScenarioSuiteResult = {
  passed: boolean;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
};

export function runScenario(fixture: unknown): ScenarioResult {
  const diagnostics = validateScenarioFixture(fixture);
  const name = readName(fixture);
  if (diagnostics.length > 0 || !isScenarioFixture(fixture)) {
    return {
      name,
      passed: false,
      diagnostics,
      mismatches: [],
    };
  }

  try {
    const telemetry = fixture.telemetry ?? telemetryFromEvent(fixture.event);
    assertValidTelemetryBundle(telemetry);
    const input: AssessmentInput = {
      event: fixture.event,
      telemetry,
      memoryRecords: fixture.memory,
    };
    const assessment = assessArchitecture(input);
    const mismatches = assertScenarioExpectation({
      result: assessment,
      expectation: fixture.expectation,
      telemetry,
    });

    return {
      name: fixture.name,
      passed: mismatches.length === 0,
      diagnostics: [],
      mismatches,
      assessment,
    };
  } catch (error) {
    return {
      name: fixture.name,
      passed: false,
      diagnostics: [{
        field: "$",
        message: error instanceof Error ? error.message : String(error),
      }],
      mismatches: [],
    };
  }
}

export function runScenarioSuite(fixtures: unknown[]): ScenarioSuiteResult {
  if (fixtures.length === 0) {
    return {
      passed: false,
      results: [],
      summary: { total: 0, passed: 0, failed: 0 },
    };
  }

  const results = fixtures.map(runScenario);
  const passed = results.filter((result) => result.passed).length;
  return {
    passed: passed === results.length,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
  };
}

export function validateScenarioFixture(fixture: unknown): ScenarioDiagnostic[] {
  const diagnostics: ScenarioDiagnostic[] = [];
  if (!isRecord(fixture)) {
    return [{ field: "$", message: "scenario fixture must be an object" }];
  }

  if (!nonEmptyString(fixture.name)) {
    diagnostics.push({ field: "name", message: "must be a non-empty string" });
  }
  if (!isRecord(fixture.event)) {
    diagnostics.push({ field: "event", message: "is required" });
  }
  if (!Array.isArray(fixture.memory)) {
    diagnostics.push({ field: "memory", message: "must be an array" });
  }

  if (!isRecord(fixture.expectation)) {
    diagnostics.push({ field: "expectation", message: "is required" });
    return diagnostics;
  }

  validateStringArray(
    fixture.expectation,
    "requiredThresholds",
    diagnostics,
    fixture.expectation.expectedSilence !== true,
  );
  validateStringArray(fixture.expectation, "allowedInterventions", diagnostics, true);
  validateStringArray(fixture.expectation, "expectedActions", diagnostics, true);
  validateStringArray(fixture.expectation, "forbiddenActions", diagnostics);
  validateStringArray(fixture.expectation, "requiredSignalFamilies", diagnostics);
  validateStringArray(fixture.expectation, "requiredEvidenceCategories", diagnostics);

  if (fixture.telemetry !== undefined && !isRecord(fixture.telemetry)) {
    diagnostics.push({ field: "telemetry", message: "must be an object when provided" });
  }
  if (hasContradictoryActions(fixture.expectation)) {
    diagnostics.push({
      field: "expectation",
      message: "expectedActions and forbiddenActions must not overlap",
    });
  }
  if (hasUnknownValues(fixture.expectation.expectedActions, coachActions)) {
    diagnostics.push({
      field: "expectation.expectedActions",
      message: "contains unknown action names",
    });
  }
  if (hasUnknownValues(fixture.expectation.forbiddenActions, coachActions)) {
    diagnostics.push({
      field: "expectation.forbiddenActions",
      message: "contains unknown action names",
    });
  }
  if (hasUnknownValues(fixture.expectation.allowedInterventions, interventionLevels)) {
    diagnostics.push({
      field: "expectation.allowedInterventions",
      message: "contains unknown intervention levels",
    });
  }

  return diagnostics;
}

function isScenarioFixture(value: unknown): value is ScenarioFixture {
  return validateScenarioFixture(value).length === 0;
}

function validateStringArray(
  value: Record<string, unknown>,
  field: string,
  diagnostics: ScenarioDiagnostic[],
  requireItems = false,
): void {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    diagnostics.push({ field: `expectation.${field}`, message: "must be an array" });
    return;
  }
  if (requireItems && candidate.length === 0) {
    diagnostics.push({
      field: `expectation.${field}`,
      message: "must contain at least one item",
    });
  }
  if (!candidate.every((item) => typeof item === "string" && item.length > 0)) {
    diagnostics.push({
      field: `expectation.${field}`,
      message: "must contain only non-empty strings",
    });
  }
}

function hasContradictoryActions(expectation: Record<string, unknown>): boolean {
  if (!Array.isArray(expectation.expectedActions) || !Array.isArray(expectation.forbiddenActions)) {
    return false;
  }
  const forbidden = new Set(expectation.forbiddenActions);
  return expectation.expectedActions.some((action) => forbidden.has(action));
}

function hasUnknownValues(value: unknown, allowed: Set<string>): boolean {
  return Array.isArray(value)
    && value.some((item) => typeof item === "string" && !allowed.has(item));
}

function readName(value: unknown): string {
  return isRecord(value) && nonEmptyString(value.name) ? value.name : "unnamed scenario";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const interventionLevels = new Set([
  "silent",
  "note",
  "recommend",
  "interview-required",
  "decision-required",
  "block",
]);

const coachActions = new Set([
  "Continue",
  "Localize",
  "Name",
  "Extract",
  "Assign ownership",
  "Insert boundary",
  "Record decision",
  "Add test harness",
  "Run review",
  "Split module",
  "Replace substrate",
  "Operationalize",
  "Stop and decide",
]);
