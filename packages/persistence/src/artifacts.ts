import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ArtifactPaths,
  LatestAssessmentPack,
  PersistedAnswer,
  PersistedDecision,
} from "./types.js";
import { defaultPersistenceDir } from "./types.js";
import type { TechLeadPersistenceStore } from "./store.js";

export function materializeAssessmentArtifacts(
  pack: LatestAssessmentPack,
  store: Pick<TechLeadPersistenceStore, "storeDir" | "saveArtifact">,
): ArtifactPaths {
  mkdirSync(store.storeDir, { recursive: true });
  const paths: ArtifactPaths = {
    latestAssessmentMd: join(store.storeDir, "latest-assessment.md"),
    latestAssessmentJson: join(store.storeDir, "latest-assessment.json"),
    questionsJson: join(store.storeDir, "questions.json"),
    evidenceJson: join(store.storeDir, "evidence.json"),
    nextActionsMd: join(store.storeDir, "next-actions.md"),
    decisionsJsonl: join(store.storeDir, "decisions.jsonl"),
    changesSinceLastMd: join(store.storeDir, "changes-since-last.md"),
  };

  const latestJson = {
    run: pack.run,
    previousRunId: pack.previousRun?.runId,
    openQuestions: pack.openQuestions,
    answeredQuestions: pack.answeredQuestions,
    skippedQuestions: pack.skippedQuestions,
    decisions: pack.decisions,
    artifactPaths: paths,
  };
  writeFileSync(paths.latestAssessmentJson, `${JSON.stringify(latestJson, null, 2)}\n`, "utf8");
  writeFileSync(paths.latestAssessmentMd, renderLatestAssessment(pack), "utf8");
  writeFileSync(paths.questionsJson, `${JSON.stringify(renderQuestionState(pack), null, 2)}\n`, "utf8");
  writeFileSync(paths.evidenceJson, `${JSON.stringify(renderEvidence(pack), null, 2)}\n`, "utf8");
  writeFileSync(paths.nextActionsMd, renderNextActions(pack), "utf8");
  writeFileSync(paths.decisionsJsonl, renderDecisionsJsonl(pack.decisions), "utf8");
  writeFileSync(paths.changesSinceLastMd, renderChangesSinceLast(pack), "utf8");

  for (const [name, path] of Object.entries(paths)) {
    store.saveArtifact(pack.run.runId, name, path);
  }

  return paths;
}

export function artifactDirectory(repoRoot: string, persistenceDir = defaultPersistenceDir): string {
  return join(repoRoot, persistenceDir);
}

export function renderLatestAssessment(pack: LatestAssessmentPack): string {
  const assessment = pack.run.assessment;
  const lines = [
    "# Ceetrix Tech Lead Assessment",
    "",
    `Run: ${pack.run.runId}`,
    `Captured: ${pack.run.capturedAt}`,
    `Repository: ${pack.run.repoRoot}`,
    `Lifecycle: ${pack.run.lifecycleState}`,
    `Status: ${assessment.status}`,
    `Intervention: ${assessment.intervention}`,
    `Action: ${assessment.action}`,
    `Reason: ${assessment.reason}`,
    "",
    "## Observed Architecture Shape",
    ...architectureShapeLines(pack),
    "",
    "## Next Actions",
    ...nextActionLines(pack),
    "",
    "## Open Questions",
    ...questionLines(pack.openQuestions),
    "",
    "## Answered Questions",
    ...answerLines(pack.answeredQuestions),
    "",
    "## Skipped Questions",
    ...answerLines(pack.skippedQuestions),
    "",
    "## Evidence",
    ...assessment.evidence.map((item) => {
      const family = item.family ? `${item.family}/` : "";
      const category = item.category ? `:${item.category}` : "";
      return `- ${family}${item.source}${category}: ${item.summary}`;
    }),
    "",
    "## Diagnostics",
    ...diagnosticLines(pack),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function architectureShapeLines(pack: LatestAssessmentPack): string[] {
  const shapeConcerns = new Set([
    "application_shape",
    "package_boundary",
    "entrypoint",
    "testing",
  ]);
  const facts = pack.run.assessment.baseline.facts.filter((fact) =>
    shapeConcerns.has(fact.concern)
  );
  if (facts.length === 0) {
    return ["- No concrete architecture shape evidence was captured."];
  }
  return facts.slice(0, 6).map((fact) =>
    `- ${fact.concern} (${fact.confidence}): ${fact.summary}`,
  );
}

function renderQuestionState(pack: LatestAssessmentPack): Record<string, unknown> {
  return {
    runId: pack.run.runId,
    answerContract: {
      cli: "archcoach answer --repo <path> --question <id> --answer <text>",
      mcp: "architecture.answer_question",
      actions: ["confirm", "correct", "mark_temporary", "skip"],
    },
    open: pack.openQuestions,
    answered: pack.answeredQuestions,
    skipped: pack.skippedQuestions,
  };
}

function renderEvidence(pack: LatestAssessmentPack): Record<string, unknown> {
  const byFamily: Record<string, unknown[]> = {};
  for (const item of pack.run.assessment.evidence) {
    const family = item.family ?? "baseline";
    byFamily[family] = [...(byFamily[family] ?? []), item];
  }
  return {
    runId: pack.run.runId,
    baseline: pack.run.assessment.baseline,
    evidenceByFamily: byFamily,
    diagnostics: [
      ...pack.run.diagnostics,
      ...pack.run.assessment.baseline.diagnostics,
    ],
    context: {
      priorDecisionRecords: pack.run.assessment.memory.decisionCount,
      priorDecisionRecordsAreRequired: false,
    },
  };
}

function renderNextActions(pack: LatestAssessmentPack): string {
  return `${[
    "# Next Actions",
    "",
    ...nextActionLines(pack),
    "",
    "## Blocked By Open Questions",
    ...pack.openQuestions.map((question) => `- ${question.id}: ${question.prompt}`),
    ...(pack.openQuestions.length === 0 ? ["- Nothing is blocked by open questions."] : []),
    "",
  ].join("\n")}\n`;
}

function renderDecisionsJsonl(decisions: PersistedDecision[]): string {
  return decisions.map((decision) => JSON.stringify(decision)).join("\n")
    + (decisions.length > 0 ? "\n" : "");
}

function renderChangesSinceLast(pack: LatestAssessmentPack): string {
  if (!pack.previousRun) {
    return "# Changes Since Last Assessment\n\n- No previous assessment exists.\n";
  }
  const previous = pack.previousRun.assessment;
  const current = pack.run.assessment;
  const lines = [
    "# Changes Since Last Assessment",
    "",
    `Previous run: ${pack.previousRun.runId}`,
    `Current run: ${pack.run.runId}`,
    "",
    "## Recommendation",
    `- Previous: ${previous.action} (${previous.reason})`,
    `- Current: ${current.action} (${current.reason})`,
    "",
    "## Evidence Count",
    `- Previous: ${previous.evidence.length}`,
    `- Current: ${current.evidence.length}`,
    "",
    "## Question Count",
    `- Previous: ${previous.questions.length}`,
    `- Current open: ${pack.openQuestions.length}`,
    `- Answered total: ${pack.answeredQuestions.length}`,
    `- Skipped total: ${pack.skippedQuestions.length}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function nextActionLines(pack: LatestAssessmentPack): string[] {
  const assessment = pack.run.assessment;
  const lines = [
    `- ${assessment.action}: ${assessment.reason}`,
  ];
  for (const guidance of assessment.principleGuidance.slice(0, 5)) {
    for (const pattern of guidance.patterns.slice(0, 2)) {
      lines.push(`- ${guidance.concern}/${pattern.pattern}: ${pattern.addNow}`);
    }
  }
  if (assessment.doNotAdd.length > 0) {
    lines.push("Do not add yet:");
    for (const item of assessment.doNotAdd) {
      lines.push(`- ${item}`);
    }
  }
  return lines;
}

function questionLines(questions: LatestAssessmentPack["openQuestions"]): string[] {
  if (questions.length === 0) {
    return ["- No open questions."];
  }
  return questions.flatMap((question) => [
    `- ${question.id}: ${question.prompt}`,
    `  Reason: ${question.reason}`,
  ]);
}

function answerLines(answers: PersistedAnswer[]): string[] {
  if (answers.length === 0) {
    return ["- None."];
  }
  return answers.map((answer) =>
    `- ${answer.questionId}: ${answer.action}${answer.value ? `: ${answer.value}` : ""}`,
  );
}

function diagnosticLines(pack: LatestAssessmentPack): string[] {
  const diagnostics = [
    ...pack.run.diagnostics,
    ...pack.run.assessment.baseline.diagnostics,
  ];
  if (diagnostics.length === 0) {
    return ["- No diagnostics."];
  }
  return diagnostics.map((diagnostic) =>
    `- ${diagnostic.severity}: ${diagnostic.message}`,
  );
}
