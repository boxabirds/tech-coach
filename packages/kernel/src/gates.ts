import type { AssessmentResult } from "./assessment.js";
import type { BaselineQuestion } from "./baselineTypes.js";
import type { ArchitecturalTelemetryBundle } from "./telemetryTypes.js";

export type GateMode = "advisory" | "balanced" | "strict";

export type StopGateInput = {
  mode: GateMode;
  unresolved: AssessmentResult[];
  unresolvedQuestions?: BaselineQuestion[];
  telemetry?: ArchitecturalTelemetryBundle;
  loopGuardActive: boolean;
};

export type StopGateDecision = {
  outcome: "finish" | "note" | "block";
  reason?: string;
  signalIds?: string[];
  questionIds?: string[];
  message?: string;
};

const highRiskConcerns = new Set([
  "data_storage",
  "authentication",
  "authorization",
  "deployment",
  "api_contract",
  "risk_hotspot",
]);

export function evaluateUnsafeCompletionGate(input: StopGateInput): StopGateDecision {
  if (input.loopGuardActive) {
    return {
      outcome: "finish",
      reason: "Stop gate loop guard is active.",
    };
  }

  const unresolved = actionableAssessments(input.unresolved);
  const questions = input.unresolvedQuestions ?? unresolved.flatMap((item) => item.questions);
  const highRiskQuestions = questions.filter((question) => highRiskConcerns.has(question.concern));
  const blockAssessments = unresolved.filter((item) => item.intervention === "block");
  const recommendAssessments = unresolved.filter((item) => item.intervention === "recommend");

  if (input.mode === "advisory") {
    if (unresolved.length === 0 && highRiskQuestions.length === 0) {
      return { outcome: "finish" };
    }
    return {
      outcome: "note",
      reason: "Advisory mode does not block completion.",
      message: formatGateMessage({
        mode: input.mode,
        reason: "Unresolved architecture guidance remains, but advisory mode allows completion.",
        unresolved,
        questions,
        signalIds: signalIdsFor(input.telemetry, unresolved),
      }),
      signalIds: signalIdsFor(input.telemetry, unresolved),
      questionIds: questions.map((question) => question.id),
    };
  }

  if (input.mode === "balanced") {
    if (blockAssessments.length > 0 || highRiskQuestions.length > 0) {
      const reason = blockAssessments[0]?.reason
        ?? `Required clarification is unresolved: ${highRiskQuestions[0]?.prompt ?? "architecture question"}`;
      return blockDecision(input, unresolved, highRiskQuestions, reason);
    }
    return { outcome: "finish" };
  }

  if (recommendAssessments.length > 0 || blockAssessments.length > 0 || questions.length > 0) {
    const reason = (blockAssessments[0] ?? recommendAssessments[0])?.reason
      ?? `Required clarification is unresolved: ${questions[0]?.prompt ?? "architecture question"}`;
    return blockDecision(input, unresolved, questions, reason);
  }

  return { outcome: "finish" };
}

function blockDecision(
  input: StopGateInput,
  unresolved: AssessmentResult[],
  questions: BaselineQuestion[],
  reason: string,
): StopGateDecision {
  const signalIds = signalIdsFor(input.telemetry, unresolved);
  return {
    outcome: "block",
    reason,
    signalIds,
    questionIds: questions.map((question) => question.id),
    message: formatGateMessage({
      mode: input.mode,
      reason,
      unresolved,
      questions,
      signalIds,
    }),
  };
}

function actionableAssessments(items: AssessmentResult[]): AssessmentResult[] {
  return items.filter((item) =>
    item.intervention === "recommend"
    || item.intervention === "block"
    || item.questions.length > 0
    || item.revisitAlerts.length > 0
  );
}

function signalIdsFor(
  telemetry: ArchitecturalTelemetryBundle | undefined,
  unresolved: AssessmentResult[],
): string[] {
  const fromAssessment = unresolved.flatMap((item) =>
    item.evidence.map((evidence) => evidence.signalId).filter((id): id is string => Boolean(id))
  );
  const fromTelemetry = telemetry
    ? [
        ...telemetry.lifecycle,
        ...telemetry.repository,
        ...telemetry.change,
        ...telemetry.test,
        ...telemetry.memory,
        ...telemetry.runtime,
      ].map((signal) => signal.id)
    : [];
  return Array.from(new Set([...fromAssessment, ...fromTelemetry])).slice(0, 8);
}

function formatGateMessage(input: {
  mode: GateMode;
  reason: string;
  unresolved: AssessmentResult[];
  questions: BaselineQuestion[];
  signalIds: string[];
}): string {
  const first = input.unresolved[0];
  const lines = [
    `Architecture completion gate (${input.mode} mode): ${input.reason}`,
  ];
  if (first) {
    lines.push(`Required action: ${first.action}.`);
  }
  if (input.questions.length > 0) {
    lines.push("Unresolved clarification:");
    for (const question of input.questions.slice(0, 3)) {
      lines.push(`- [${question.id}] ${question.prompt}`);
    }
  }
  if (input.signalIds.length > 0) {
    lines.push(`Telemetry: ${input.signalIds.slice(0, 5).join(", ")}`);
  }
  lines.push("Continue the conversation by resolving this item; do not invent answers on the user's behalf.");
  return lines.join("\n");
}
