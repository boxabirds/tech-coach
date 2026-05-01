import type { AssessmentResult } from "../../kernel/src/assessment.js";
import {
  evaluateUnsafeCompletionGate,
  type GateMode,
  type StopGateDecision,
} from "../../kernel/src/gates.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import type { CoachMode } from "./hookAdapter.js";

export type ClaudeStopGateInput = {
  mode: CoachMode;
  assessment?: AssessmentResult;
  unresolved?: AssessmentResult[];
  unresolvedQuestions?: BaselineQuestion[];
  telemetry?: ArchitecturalTelemetryBundle;
  loopGuardActive: boolean;
};

export function evaluateClaudeStopGate(input: ClaudeStopGateInput): StopGateDecision {
  return evaluateUnsafeCompletionGate({
    mode: normalizeGateMode(input.mode),
    unresolved: input.unresolved ?? (input.assessment ? [input.assessment] : []),
    unresolvedQuestions: input.unresolvedQuestions,
    telemetry: input.telemetry,
    loopGuardActive: input.loopGuardActive,
  });
}

function normalizeGateMode(mode: CoachMode): GateMode {
  return mode === "balanced" || mode === "strict" ? mode : "advisory";
}
