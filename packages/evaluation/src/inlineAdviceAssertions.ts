export type InlineAdviceFailureKind =
  | "missing_provenance"
  | "missing_grounded_recommendation"
  | "interview_first"
  | "too_many_questions"
  | "current_state_question"
  | "raw_id_exposed";

export type InlineAdviceExpectation = {
  prompt: string;
  response: string;
  expectedEvidenceAreas: string[];
  maxResidualQuestions?: number;
};

export type InlineAdviceFailure = {
  kind: InlineAdviceFailureKind;
  message: string;
};

export function assertInlineAdviceResponse(
  input: InlineAdviceExpectation,
): InlineAdviceFailure[] {
  const failures: InlineAdviceFailure[] = [];
  const response = input.response.trim();
  const lower = response.toLowerCase();
  const questionIndex = firstQuestionIndex(response);
  const recommendationIndex = firstRecommendationIndex(lower);

  if (!containsAny(lower, ["tech lead", "baseline", "assessment graph", "coach context"])) {
    failures.push({
      kind: "missing_provenance",
      message: "Response does not say Tech Lead context or baseline evidence was used.",
    });
  }

  if (
    recommendationIndex < 0
    || !input.expectedEvidenceAreas.every((area) => lower.includes(area.toLowerCase()))
  ) {
    failures.push({
      kind: "missing_grounded_recommendation",
      message: "Response lacks a recommendation grounded in the expected evidence areas.",
    });
  }

  if (
    containsAny(lower.slice(0, 220), [
      "before i can advise",
      "before suggesting",
      "before i recommend",
      "i need to understand",
      "i need to know",
    ])
    || (questionIndex >= 0 && (recommendationIndex < 0 || questionIndex < recommendationIndex))
  ) {
    failures.push({
      kind: "interview_first",
      message: "Response asks broad questions before giving a grounded recommendation.",
    });
  }

  const questionCount = countQuestions(response);
  const maxQuestions = input.maxResidualQuestions ?? 2;
  if (questionCount > maxQuestions) {
    failures.push({
      kind: "too_many_questions",
      message: `Response asks ${questionCount} questions; maximum is ${maxQuestions}.`,
    });
  }

  if (containsAny(lower, [
    "what does \"local-only\" mean",
    "what does local-only mean",
    "what's the trigger",
    "what data and features matter",
    "are you looking to replace the workers layer",
    "current state:",
  ])) {
    failures.push({
      kind: "current_state_question",
      message: "Response asks broad current-state or taxonomy questions instead of using baseline evidence.",
    });
  }

  if (/\b(question|claim|evidence|node)-[a-z0-9:_-]{12,}/i.test(response)) {
    failures.push({
      kind: "raw_id_exposed",
      message: "Response exposes raw graph or question identifiers.",
    });
  }

  return failures;
}

function firstQuestionIndex(response: string): number {
  const questionMark = response.indexOf("?");
  const clarify = response.toLowerCase().search(/\b(clarify|what does|what's|which|do you|does this)\b/);
  if (questionMark < 0) {
    return clarify;
  }
  if (clarify < 0) {
    return questionMark;
  }
  return Math.min(questionMark, clarify);
}

function firstRecommendationIndex(response: string): number {
  const markers = [
    "recommend",
    "default",
    "best path",
    "likely direction",
    "start by",
    "treat this as",
    "build this as",
  ];
  return markers
    .map((marker) => response.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
}

function countQuestions(response: string): number {
  return (response.match(/\?/g) ?? []).length;
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
