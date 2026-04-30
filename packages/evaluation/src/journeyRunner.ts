import {
  assessArchitecture,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { DecisionRecord } from "../../kernel/src/memory.js";
import {
  applyBaselineAnswers,
} from "../../kernel/src/baselineMerge.js";
import type {
  ArchitectureBaseline,
  BaselineAnswer,
} from "../../kernel/src/baselineTypes.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import {
  assertTurnTiming,
  type TimingMismatch,
  type TurnExpectation,
} from "./timingAssertions.js";

export type JourneyFixture = {
  name: string;
  turns: JourneyTurn[];
  initialMemory: DecisionRecord[];
};

export type JourneyTurn = {
  turn: number;
  event: CoachEventEnvelope;
  telemetry?: ArchitecturalTelemetryBundle;
  correlationId?: string;
  expected: TurnExpectation;
  hostAnswers?: BaselineAnswer[];
};

export type JourneyDiagnostic = {
  field: string;
  message: string;
};

export type JourneyTurnResult = {
  turn: number;
  passed: boolean;
  diagnostics: JourneyDiagnostic[];
  mismatches: TimingMismatch[];
  correlationId?: string;
  assessment?: AssessmentResult;
  answeredBaseline?: ArchitectureBaseline;
  carriedBaseline?: ArchitectureBaseline;
  questionIds: string[];
  appliedAnswerQuestionIds: string[];
  memoryDecisionCount: number;
};

export type JourneyResult = {
  name: string;
  passed: boolean;
  diagnostics: JourneyDiagnostic[];
  turns: JourneyTurnResult[];
  summary: {
    totalTurns: number;
    passedTurns: number;
    failedTurns: number;
  };
};

export function runJourney(fixture: unknown): JourneyResult {
  const diagnostics = validateJourneyFixture(fixture);
  const name = readName(fixture);
  if (diagnostics.length > 0 || !isJourneyFixture(fixture)) {
    return {
      name,
      passed: false,
      diagnostics,
      turns: [],
      summary: { totalTurns: 0, passedTurns: 0, failedTurns: 0 },
    };
  }

  const memory = [...fixture.initialMemory];
  const turns: JourneyTurnResult[] = [];
  let priorAssessment: AssessmentResult | undefined;
  let carriedBaseline: ArchitectureBaseline | undefined;

  for (const turn of fixture.turns) {
    const result = runJourneyTurn(turn, memory, priorAssessment, carriedBaseline);
    turns.push(result);
    if (result.assessment) {
      priorAssessment = result.assessment;
    }
    if (result.carriedBaseline) {
      carriedBaseline = result.carriedBaseline;
    }
  }

  const passedTurns = turns.filter((turn) => turn.passed).length;
  return {
    name: fixture.name,
    passed: passedTurns === turns.length,
    diagnostics: [],
    turns,
    summary: {
      totalTurns: turns.length,
      passedTurns,
      failedTurns: turns.length - passedTurns,
    },
  };
}

export function validateJourneyFixture(fixture: unknown): JourneyDiagnostic[] {
  const diagnostics: JourneyDiagnostic[] = [];
  if (!isRecord(fixture)) {
    return [{ field: "$", message: "journey fixture must be an object" }];
  }

  if (!nonEmptyString(fixture.name)) {
    diagnostics.push({ field: "name", message: "must be a non-empty string" });
  }
  if (!Array.isArray(fixture.initialMemory)) {
    diagnostics.push({ field: "initialMemory", message: "must be an array" });
  }
  if (!Array.isArray(fixture.turns)) {
    diagnostics.push({ field: "turns", message: "must be an array" });
    return diagnostics;
  }
  if (fixture.turns.length === 0) {
    diagnostics.push({ field: "turns", message: "must contain at least one turn" });
    return diagnostics;
  }

  const seen = new Set<number>();
  let expectedTurn = 1;
  for (const [index, turn] of fixture.turns.entries()) {
    const prefix = `turns[${index}]`;
    if (!isRecord(turn)) {
      diagnostics.push({ field: prefix, message: "must be an object" });
      continue;
    }
    if (typeof turn.turn !== "number") {
      diagnostics.push({ field: `${prefix}.turn`, message: "must be a number" });
    } else {
      if (seen.has(turn.turn)) {
        diagnostics.push({ field: `${prefix}.turn`, message: "must be unique" });
      }
      if (turn.turn !== expectedTurn) {
        diagnostics.push({
          field: `${prefix}.turn`,
          message: `must preserve turn order starting at ${expectedTurn}`,
        });
      }
      seen.add(turn.turn);
      expectedTurn += 1;
    }
    if (!isRecord(turn.event)) {
      diagnostics.push({ field: `${prefix}.event`, message: "is required" });
    }
    if (!nonEmptyString(turn.correlationId)) {
      diagnostics.push({ field: `${prefix}.correlationId`, message: "is required" });
    }
    if (!isRecord(turn.expected)) {
      diagnostics.push({ field: `${prefix}.expected`, message: "is required" });
    } else if (!nonEmptyString(turn.expected.expectedIntervention)) {
      diagnostics.push({
        field: `${prefix}.expected.expectedIntervention`,
        message: "is required",
      });
    }
    if (turn.hostAnswers !== undefined && !Array.isArray(turn.hostAnswers)) {
      diagnostics.push({ field: `${prefix}.hostAnswers`, message: "must be an array" });
    }
  }

  return diagnostics;
}

function runJourneyTurn(
  turn: JourneyTurn,
  memory: DecisionRecord[],
  priorAssessment: AssessmentResult | undefined,
  priorBaseline: ArchitectureBaseline | undefined,
): JourneyTurnResult {
  try {
    const telemetry = turn.telemetry ?? telemetryFromEvent(turn.event, {
      correlationId: turn.correlationId,
    });
    assertValidTelemetryBundle(telemetry);
    const input: AssessmentInput = {
      event: turn.event,
      telemetry,
      memoryRecords: memory,
    };
    const assessment = assessArchitecture(input);
    const answeredBaseline = turn.hostAnswers
      ? applyBaselineAnswers({
        baseline: assessment.baseline,
        questions: assessment.questions,
        answers: turn.hostAnswers,
        recordedAt: "2026-04-30T12:00:00.000Z",
      })
      : undefined;
    const carriedBaseline = answeredBaseline ?? priorBaseline;
    const mismatches = assertTurnTiming({
      assessment,
      expectation: turn.expected,
      telemetry,
      priorAssessment,
      answeredBaseline: carriedBaseline,
      correlationId: turn.correlationId,
    });

    return {
      turn: turn.turn,
      passed: mismatches.length === 0,
      diagnostics: [],
      mismatches,
      correlationId: turn.correlationId,
      assessment,
      answeredBaseline,
      carriedBaseline,
      questionIds: assessment.questions.map((question) => question.id),
      appliedAnswerQuestionIds: turn.hostAnswers?.map((answer) => answer.questionId) ?? [],
      memoryDecisionCount: memory.length,
    };
  } catch (error) {
    return {
      turn: turn.turn,
      passed: false,
      diagnostics: [{
        field: `turns[${turn.turn - 1}]`,
        message: error instanceof Error ? error.message : String(error),
      }],
      mismatches: [],
      correlationId: turn.correlationId,
      questionIds: [],
      appliedAnswerQuestionIds: turn.hostAnswers?.map((answer) => answer.questionId) ?? [],
      memoryDecisionCount: memory.length,
    };
  }
}

function isJourneyFixture(value: unknown): value is JourneyFixture {
  return validateJourneyFixture(value).length === 0;
}

function readName(value: unknown): string {
  return isRecord(value) && nonEmptyString(value.name) ? value.name : "unnamed journey";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
