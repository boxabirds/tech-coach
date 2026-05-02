import { applyBaselineAnswers } from "../../kernel/src/baselineMerge.js";
import type {
  ArchitectureBaseline,
  BaselineAnswer,
  BaselineQuestion,
} from "../../kernel/src/baselineTypes.js";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import {
  projectAnswerSemantics,
  projectStableGuidance,
  type StableAnswerSemanticsProjection,
  type StableGuidanceProjection,
} from "../../kernel/src/policy.js";
import { runAssessmentCommand } from "../../cli/src/index.js";
import {
  invokeArchitectureTool,
  type AssessmentToolResult,
} from "../../mcp/src/tools.js";
import { assessClaudeCodeEvent, type ClaudeCodeEventInput } from "./claude.js";
import { assessGenericCiEvent, type GenericCiEventInput } from "./generic.js";

export type PortableInterface = "cli" | "mcp" | "claude" | "generic_ci";

export type PortableAssessmentCase =
  | { interface: "cli"; input: unknown }
  | { interface: "mcp"; input: unknown }
  | { interface: "claude"; input: ClaudeCodeEventInput }
  | { interface: "generic_ci"; input: GenericCiEventInput };

export type PortableAssessmentOutput = {
  interface: PortableInterface;
  assessment: AssessmentResult;
  guidance: StableGuidanceProjection;
  questions: BaselineQuestion[];
  baseline: ArchitectureBaseline;
};

export type GuidanceMismatch = {
  interface: PortableInterface;
  category:
    | "assessment_mismatch"
    | "evidence_mismatch"
    | "question_mismatch"
    | "answer_semantics_mismatch";
  message: string;
};

export type GuidanceConsistencyResult = {
  ok: boolean;
  baselineInterface: PortableInterface;
  outputs: PortableAssessmentOutput[];
  mismatches: GuidanceMismatch[];
};

export function runPortableAssessment(
  testCase: PortableAssessmentCase,
): PortableAssessmentOutput {
  const assessment = runRawAssessment(testCase);
  return {
    interface: testCase.interface,
    assessment,
    guidance: projectStableGuidance(assessment),
    questions: assessment.questions,
    baseline: assessment.baseline,
  };
}

export function checkGuidanceConsistency(
  cases: PortableAssessmentCase[],
): GuidanceConsistencyResult {
  if (cases.length === 0) {
    throw new Error("at least one assessment case is required");
  }
  const outputs = cases.map(runPortableAssessment);
  const baseline = outputs[0];
  const mismatches: GuidanceMismatch[] = [];

  for (const output of outputs.slice(1)) {
    mismatches.push(...compareGuidance(baseline, output));
  }

  return {
    ok: mismatches.length === 0,
    baselineInterface: baseline.interface,
    outputs,
    mismatches,
  };
}

export function applyAnswersForInterface(
  target: PortableInterface,
  baseline: ArchitectureBaseline,
  questions: BaselineQuestion[],
  answers: BaselineAnswer[],
  recordedAt = "2026-04-30T18:00:00.000Z",
): StableAnswerSemanticsProjection {
  if (target === "mcp") {
    const result = invokeArchitectureTool("architecture.apply_interview_answers", {
      baseline,
      questions,
      answers,
      recordedAt,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return projectAnswerSemantics(result.result as ArchitectureBaseline);
  }

  return projectAnswerSemantics(
    applyBaselineAnswers({ baseline, questions, answers, recordedAt }),
  );
}

export function checkAnswerSemanticsConsistency(
  output: PortableAssessmentOutput,
  answers: BaselineAnswer[],
  interfaces: PortableInterface[] = ["cli", "mcp", "claude", "generic_ci"],
): { ok: boolean; projections: Record<string, StableAnswerSemanticsProjection>; mismatches: GuidanceMismatch[] } {
  const projections: Record<string, StableAnswerSemanticsProjection> = {};
  for (const target of interfaces) {
    projections[target] = applyAnswersForInterface(
      target,
      output.baseline,
      output.questions,
      answers,
    );
  }

  const [baselineInterface, baselineProjection] = Object.entries(projections)[0];
  const mismatches: GuidanceMismatch[] = [];
  for (const [target, projection] of Object.entries(projections).slice(1)) {
    if (!sameJson(baselineProjection, projection)) {
      mismatches.push({
        interface: target as PortableInterface,
        category: "answer_semantics_mismatch",
        message: `${target} answer semantics differ from ${baselineInterface}`,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    projections,
    mismatches,
  };
}

function runRawAssessment(testCase: PortableAssessmentCase): AssessmentResult {
  switch (testCase.interface) {
    case "cli":
      return runAssessmentCommand(
        testCase.input,
        { output: "json", readOnly: true },
        {
          cwd: "/repo",
          readFile: () => {
            throw new Error("portable consistency checks must not read memory");
          },
          fileExists: () => false,
        },
      ).result;
    case "mcp": {
      const result = invokeArchitectureTool("architecture.assess_change", testCase.input);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return (result.result as AssessmentToolResult).assessment;
    }
    case "claude":
      return assessClaudeCodeEvent(testCase.input).assessment;
    case "generic_ci":
      return assessGenericCiEvent(testCase.input).assessment;
  }
}

function compareGuidance(
  baseline: PortableAssessmentOutput,
  actual: PortableAssessmentOutput,
): GuidanceMismatch[] {
  const mismatches: GuidanceMismatch[] = [];
  if (!sameJson(stripEvidenceAndQuestions(baseline.guidance), stripEvidenceAndQuestions(actual.guidance))) {
    mismatches.push({
      interface: actual.interface,
      category: "assessment_mismatch",
      message: `${actual.interface} assessment policy differs from ${baseline.interface}`,
    });
  }
  if (!sameJson(baseline.guidance.evidence, actual.guidance.evidence)) {
    mismatches.push({
      interface: actual.interface,
      category: "evidence_mismatch",
      message: `${actual.interface} evidence differs from ${baseline.interface}`,
    });
  }
  if (!sameJson(baseline.guidance.questions, actual.guidance.questions)) {
    mismatches.push({
      interface: actual.interface,
      category: "question_mismatch",
      message: `${actual.interface} interview questions differ from ${baseline.interface}`,
    });
  }
  return mismatches;
}

function stripEvidenceAndQuestions(
  guidance: StableGuidanceProjection,
): Omit<StableGuidanceProjection, "evidence" | "questions"> {
  const { evidence: _evidence, questions: _questions, ...rest } = guidance;
  return rest;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
