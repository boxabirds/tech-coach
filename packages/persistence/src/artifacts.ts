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
    "# Tech Lead Assessment",
    "",
    "This report explains what Tech Lead noticed and what it means for the next change.",
    "Technical detail: the durable source of truth is the local database recorded below; this Markdown file is a readable projection of the latest run.",
    "",
    `Run: ${pack.run.runId}`,
    `Captured: ${pack.run.capturedAt}`,
    `Repository: ${pack.run.repoRoot}`,
    `Store: ${pack.storePath}`,
    `Lifecycle: ${pack.run.lifecycleState}`,
    `Status: ${assessment.status}`,
    `Intervention: ${assessment.intervention}`,
    `Action: ${assessment.action}`,
    `Reason: ${assessment.reason}`,
    "",
    "## What Tech Lead Thinks Matters",
    ...claimLines(pack),
    "",
    "## What The Repo Looks Like",
    ...architectureShapeLines(pack),
    "",
    "## Time Basis",
    ...temporalBriefLines(pack),
    "",
    passiveBaseline(pack) ? "## Baseline Readout" : "## Next Actions",
    ...nextActionLines(pack),
    "",
    passiveBaseline(pack) ? "## Optional Future Context" : "## Open Questions",
    ...questionLines(pack.openQuestions),
    "",
    "## Answered Questions",
    ...answerLines(pack.answeredQuestions),
    "",
    "## Skipped Questions",
    ...answerLines(pack.skippedQuestions),
    "",
    "## Supporting Evidence",
    ...assessment.evidence.map((item) => {
      const family = item.family ? `${item.family}/` : "";
      const category = item.category ? `:${item.category}` : "";
      const temporal = item.timeframe ? ` (${item.timeframe}${item.role ? `, ${item.role}` : ""})` : "";
      return `- ${family}${item.source}${category}${temporal}: ${item.summary}`;
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
    return ["- Tech Lead did not find enough repo shape evidence to summarize yet."];
  }
  return facts.slice(0, 6).map((fact) =>
    `- ${fact.summary} Technical detail: ${fact.concern}, confidence ${fact.confidence}.`,
  );
}

function claimLines(pack: LatestAssessmentPack): string[] {
  const claims = pack.run.assessment.claims ?? [];
  if (claims.length === 0) {
    return ["- Tech Lead did not find any concrete claims to carry forward yet."];
  }
  return claims.flatMap((claim) => [
    `- ${claim.claim} Technical detail: ${claim.concern}, confidence ${claim.confidence}.`,
    ...(claim.evidence.length > 0
      ? [`  Supporting evidence: ${claim.evidence.slice(0, 4).join("; ")}`]
      : []),
    ...(claim.residualUnknowns.length > 0
      ? [`  Still unclear: ${claim.residualUnknowns.join("; ")}`]
      : []),
  ]);
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
    claims: pack.run.assessment.claims ?? [],
    normalizedFacts: normalizedFactsFromPack(pack),
    evidenceByFamily: byFamily,
    temporalBrief: pack.run.assessment.temporalBrief,
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

function normalizedFactsFromPack(pack: LatestAssessmentPack): unknown[] {
  const signals = [
    ...(pack.run.telemetry?.repository ?? []),
    ...(pack.run.telemetry?.change ?? []),
    ...(pack.run.telemetry?.test ?? []),
    ...(pack.run.telemetry?.memory ?? []),
    ...(pack.run.telemetry?.runtime ?? []),
  ];
  const facts = signals.flatMap((signal) => {
    const details = "details" in signal.payload ? signal.payload.details : undefined;
    return details && typeof details === "object" && !Array.isArray(details) && Array.isArray((details as { facts?: unknown[] }).facts)
      ? (details as { facts: unknown[] }).facts
      : [];
  });
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const id = typeof fact === "object" && fact !== null && "id" in fact
      ? String((fact as { id?: unknown }).id)
      : JSON.stringify(fact);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function renderNextActions(pack: LatestAssessmentPack): string {
  return `${[
    passiveBaseline(pack) ? "# Baseline Readout" : "# Next Actions",
    "",
    ...nextActionLines(pack),
    "",
    passiveBaseline(pack) ? "## Future Questions" : "## Blocked By Open Questions",
    ...questionLines(pack.openQuestions),
    ...(pack.openQuestions.length === 0 && !passiveBaseline(pack) ? ["- Nothing is blocked by open questions."] : []),
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
  if (passiveBaseline(pack)) {
    return [
      `- Baseline captured: ${assessment.reason}`,
      "- No immediate architecture action is required from repository evidence alone.",
      "- Use these claims as context when you ask for a change, risk review, deployment plan, or architecture decision.",
    ];
  }
  const lines = [
    `- ${assessment.action}: ${assessment.reason}`,
  ];
  lines.push(...temporalBriefLines(pack));
  const guidance = selectedGuidance(assessment);
  const patterns = selectedPatterns(assessment, guidance);
  if (guidance) {
    for (const pattern of patterns) {
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

function temporalBriefLines(pack: LatestAssessmentPack): string[] {
  const brief = pack.run.assessment.temporalBrief;
  if (!brief || (
    brief.past.length === 0
    && brief.current.length === 0
    && brief.future.length === 0
    && brief.uncertain.length === 0
  )) {
    return ["- No temporal evidence split was available for this run."];
  }
  const lines: string[] = [];
  if (brief.future.length > 0) {
    lines.push(`- Future intent: ${brief.future[0]}`);
  }
  if (brief.current.length > 0) {
    lines.push(`- Current system: ${brief.current[0]}`);
  }
  if (brief.past.length > 0) {
    lines.push(`- Past context: ${brief.past[0]}`);
  }
  if (brief.uncertain.length > 0) {
    lines.push(`- Uncertain work: ${brief.uncertain[0]}`);
  }
  return lines;
}

function selectedGuidance(
  assessment: LatestAssessmentPack["run"]["assessment"],
): LatestAssessmentPack["run"]["assessment"]["principleGuidance"][number] | undefined {
  const concern = assessment.policy?.selected.concern;
  if (!concern) {
    return undefined;
  }
  return assessment.principleGuidance.find((item) => item.concern === concern);
}

function selectedPatterns(
  assessment: LatestAssessmentPack["run"]["assessment"],
  guidance: LatestAssessmentPack["run"]["assessment"]["principleGuidance"][number] | undefined,
): LatestAssessmentPack["run"]["assessment"]["principleGuidance"][number]["patterns"] {
  if (!guidance) {
    return [];
  }
  const patternId = assessment.policy?.selected.patternId;
  return patternId
    ? guidance.patterns.filter((pattern) => pattern.pattern === patternId)
    : guidance.patterns.slice(0, 2);
}

function questionLines(questions: LatestAssessmentPack["openQuestions"]): string[] {
  if (questions.length === 0) {
    return ["- No immediate user questions."];
  }
  return questions.flatMap((question) => [
    `- ${question.prompt}`,
    `  Question id: ${question.id}`,
    `  Reason: ${question.reason}`,
  ]);
}

function passiveBaseline(pack: LatestAssessmentPack): boolean {
  return pack.run.assessment.interactionContext === "passive_baseline";
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
