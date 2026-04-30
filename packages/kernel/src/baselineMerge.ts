import type {
  ArchitectureBaseline,
  BaselineAnswer,
  BaselineAnswerMergeInput,
  BaselineAnswerMerger,
  BaselineConfirmation,
  BaselineConfirmationStatus,
  BaselineFact,
  BaselineFactStatus,
  BaselineQuestion,
  EvidenceSourceRef,
} from "./baselineTypes.js";

const userSource: EvidenceSourceRef = {
  source: "user",
  category: "baseline_confirmation",
  status: "present",
  freshness: "current",
  confidence: "high",
};

export function applyBaselineAnswers(
  input: BaselineAnswerMergeInput,
): ArchitectureBaseline {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));
  const seenQuestions = new Set<string>();
  const baseline = cloneBaseline(input.baseline);

  for (const [index, answer] of input.answers.entries()) {
    const answerId = answer.answerId ?? `answer-${index + 1}`;
    const question = questionsById.get(answer.questionId);
    if (!question) {
      baseline.diagnostics.push({
        id: `diagnostic-answer-${index + 1}-unknown-question`,
        severity: "error",
        source: "baselineMerge",
        message: `Answer ${answerId} references unknown question ${answer.questionId}.`,
      });
      continue;
    }

    if (seenQuestions.has(answer.questionId)) {
      baseline.diagnostics.push({
        id: `diagnostic-answer-${index + 1}-duplicate-question`,
        severity: "warning",
        source: "baselineMerge",
        message: `Duplicate answer for question ${answer.questionId} was ignored.`,
      });
      continue;
    }
    seenQuestions.add(answer.questionId);

    applyAnswerToQuestion(baseline, question, answer, answerId, recordedAt);
  }

  return rebuildConcernViews(baseline);
}

export const baselineAnswerMerger: BaselineAnswerMerger = {
  applyAnswers: applyBaselineAnswers,
};

function applyAnswerToQuestion(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
): void {
  switch (answer.action) {
    case "confirm":
      applyConfirm(baseline, question, answer, answerId, recordedAt);
      return;
    case "correct":
      applyCorrection(baseline, question, answer, answerId, recordedAt);
      return;
    case "mark_temporary":
      applyTemporary(baseline, question, answer, answerId, recordedAt);
      return;
    case "skip":
      applySkip(baseline, question, answer, answerId, recordedAt);
      return;
    default:
      baseline.diagnostics.push({
        id: `diagnostic-answer-${answerId}-unsupported-action`,
        severity: "error",
        source: "baselineMerge",
        message: `Answer ${answerId} uses unsupported action ${(answer as BaselineAnswer).action}.`,
      });
  }
}

function applyConfirm(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
): void {
  const relatedFacts = factsForQuestion(baseline, question);
  if (relatedFacts.length === 0) {
    const fact = createUserFact(question, answer, answerId, "user_confirmed");
    fact.confirmations = [
      confirmationFor(fact.id, question, answer, answerId, recordedAt, "user_confirmed"),
    ];
    baseline.facts.push(fact);
    removeResolvedUnknowns(baseline, question);
    addBaselineConfirmation(baseline, fact.confirmations[0]);
    return;
  }

  for (const fact of relatedFacts) {
    fact.status = "user_confirmed";
    const confirmation = confirmationFor(
      fact.id,
      question,
      answer,
      answerId,
      recordedAt,
      "user_confirmed",
    );
    fact.confirmations = [...(fact.confirmations ?? []), confirmation];
    addBaselineConfirmation(baseline, confirmation);
  }
}

function applyCorrection(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
): void {
  const relatedFacts = factsForQuestion(baseline, question);
  const correctedFact = createUserFact(question, answer, answerId, "user_corrected");
  const confirmation = confirmationFor(
    correctedFact.id,
    question,
    answer,
    answerId,
    recordedAt,
    "user_corrected",
  );
  correctedFact.confirmations = [confirmation];
  baseline.facts.push(correctedFact);
  addBaselineConfirmation(baseline, confirmation);
  removeResolvedUnknowns(baseline, question);

  for (const fact of relatedFacts) {
    if (isStrongObservedFact(fact) && answer.value && contradictsFact(fact, answer.value)) {
      baseline.diagnostics.push({
        id: `diagnostic-${answerId}-conflicts-${fact.id}`,
        severity: "warning",
        source: "baselineMerge",
        message: `User correction for ${question.id} conflicts with observed fact ${fact.id}; preserving both records.`,
      });
    }
  }
}

function applyTemporary(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
): void {
  const relatedFacts = factsForQuestion(baseline, question);
  if (relatedFacts.length === 0) {
    const fact = createUserFact(question, answer, answerId, "intentionally_temporary");
    const confirmation = confirmationFor(
      fact.id,
      question,
      answer,
      answerId,
      recordedAt,
      "intentionally_temporary",
    );
    fact.confirmations = [confirmation];
    baseline.facts.push(fact);
    addBaselineConfirmation(baseline, confirmation);
    removeResolvedUnknowns(baseline, question);
    return;
  }

  for (const fact of relatedFacts) {
    fact.status = "intentionally_temporary";
    const confirmation = confirmationFor(
      fact.id,
      question,
      answer,
      answerId,
      recordedAt,
      "intentionally_temporary",
    );
    fact.confirmations = [...(fact.confirmations ?? []), confirmation];
    addBaselineConfirmation(baseline, confirmation);
  }
}

function applySkip(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
): void {
  const targetFactIds = question.relatedFactIds.length > 0
    ? question.relatedFactIds
    : [`unresolved-${question.id}`];

  for (const factId of targetFactIds) {
    addBaselineConfirmation(
      baseline,
      confirmationFor(factId, question, answer, answerId, recordedAt, "unresolved"),
    );
  }
}

function factsForQuestion(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
): BaselineFact[] {
  const ids = new Set(question.relatedFactIds);
  return baseline.facts.filter((fact) => ids.has(fact.id));
}

function createUserFact(
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  status: BaselineFactStatus,
): BaselineFact {
  const value = answer.value?.trim() || answer.note?.trim() || "User provided baseline confirmation";
  return {
    id: `fact-user-${sanitizeId(answerId)}`,
    concern: question.concern,
    label: value,
    status,
    confidence: "high",
    freshness: "current",
    sources: [userSource],
    summary: value,
  };
}

function confirmationFor(
  factId: string,
  question: BaselineQuestion,
  answer: BaselineAnswer,
  answerId: string,
  recordedAt: string,
  status: BaselineConfirmationStatus,
): BaselineConfirmation {
  return {
    factId,
    questionId: question.id,
    status,
    answerId,
    recordedAt: answer.recordedAt ?? recordedAt,
    ...(answer.value ? { value: answer.value } : {}),
    ...(answer.note ? { note: answer.note } : {}),
  };
}

function addBaselineConfirmation(
  baseline: ArchitectureBaseline,
  confirmation: BaselineConfirmation,
): void {
  baseline.confirmations = [...(baseline.confirmations ?? []), confirmation];
}

function removeResolvedUnknowns(
  baseline: ArchitectureBaseline,
  question: BaselineQuestion,
): void {
  if (question.relatedUnknownIds.length === 0) {
    return;
  }
  const resolved = new Set(question.relatedUnknownIds);
  baseline.unknowns = baseline.unknowns.filter((unknown) => !resolved.has(unknown.id));
}

function isStrongObservedFact(fact: BaselineFact): boolean {
  return fact.status === "observed" && fact.confidence === "high";
}

function contradictsFact(fact: BaselineFact, value: string): boolean {
  const normalizedValue = normalizeText(value);
  const observedText = normalizeText(`${fact.label} ${fact.summary}`);
  if (normalizedValue.length === 0 || observedText.length === 0) {
    return false;
  }

  if (hasOpposingArchitectureTerms(observedText, normalizedValue)) {
    return true;
  }

  const valueTokens = meaningfulTokens(normalizedValue);
  if (valueTokens.length === 0) {
    return false;
  }
  return valueTokens.every((token) => !observedText.includes(token));
}

function hasOpposingArchitectureTerms(
  observedText: string,
  correctedText: string,
): boolean {
  const opposingGroups = [
    ["localstorage", "indexeddb", "sqlite", "postgres", "database"],
    ["local", "private", "public", "production"],
    ["no authentication", "login", "oauth", "identity provider"],
    ["internal", "public api", "external"],
  ];

  return opposingGroups.some((group) => {
    const observedTerms = group.filter((term) => observedText.includes(term));
    const correctedTerms = group.filter((term) => correctedText.includes(term));
    return observedTerms.length > 0
      && correctedTerms.length > 0
      && observedTerms.some((term) => !correctedTerms.includes(term));
  });
}

function meaningfulTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !["with", "without", "this", "that", "unknown"].includes(token));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rebuildConcernViews(baseline: ArchitectureBaseline): ArchitectureBaseline {
  return {
    ...baseline,
    concerns: baseline.concerns.map((concern) => ({
      ...concern,
      facts: baseline.facts.filter((fact) => fact.concern === concern.concern),
      unknowns: baseline.unknowns.filter(
        (unknown) => unknown.concern === concern.concern,
      ),
    })),
  };
}

function cloneBaseline(baseline: ArchitectureBaseline): ArchitectureBaseline {
  return {
    ...baseline,
    concerns: baseline.concerns.map((concern) => ({
      ...concern,
      axes: { ...concern.axes },
      thresholdCandidates: [...concern.thresholdCandidates],
      facts: concern.facts.map(cloneFact),
      unknowns: concern.unknowns.map((unknown) => ({
        ...unknown,
        neededEvidence: [...unknown.neededEvidence],
      })),
    })),
    facts: baseline.facts.map(cloneFact),
    unknowns: baseline.unknowns.map((unknown) => ({
      ...unknown,
      neededEvidence: [...unknown.neededEvidence],
    })),
    diagnostics: baseline.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    confirmations: baseline.confirmations?.map((confirmation) => ({
      ...confirmation,
    })),
  };
}

function cloneFact(fact: BaselineFact): BaselineFact {
  return {
    ...fact,
    sources: fact.sources.map((source) => ({ ...source })),
    confirmations: fact.confirmations?.map((confirmation) => ({ ...confirmation })),
  };
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
