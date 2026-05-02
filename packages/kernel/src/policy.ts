import type { AssessmentEvidence, AssessmentResult } from "./assessment.js";
import type {
  ArchitectureBaseline,
  BaselineQuestion,
} from "./baselineTypes.js";

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
