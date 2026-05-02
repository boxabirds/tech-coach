import { resolve } from "node:path";
import {
  assessArchitecture,
  normalizeAssessmentInput,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import { applyBaselineAnswers } from "../../kernel/src/baselineMerge.js";
import { planBaselineInterviewQuestions } from "../../kernel/src/baselineInterview.js";
import type { BaselineAnswer, BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import type { DecisionRecord } from "../../kernel/src/memory.js";
import { normalizeHostEvent } from "../../kernel/src/normalize.js";
import { telemetryFromEvent } from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { materializeAssessmentArtifacts } from "./artifacts.js";
import { lifecycleForCapture } from "./lifecycle.js";
import { collectRepositoryTelemetry } from "./repositorySignals.js";
import {
  openPersistenceStore,
  PersistenceStoreError,
  TechLeadPersistenceStore,
  type StoreOptions,
} from "./store.js";
import type {
  ApplyPersistedAnswerInput,
  AssessmentRunSnapshot,
  CaptureAssessmentInput,
  CaptureAssessmentResult,
  ConfirmPersistedDecisionInput,
  LatestAssessmentPack,
  PersistedAnswer,
  PersistenceDiagnostic,
} from "./types.js";
import { defaultDatabaseFile, defaultPersistenceDir } from "./types.js";

const defaultCaptureRequest = "Capture a passive repository baseline.";

export function captureAssessment(
  input: CaptureAssessmentInput,
  storeOptions: StoreOptions = {},
): CaptureAssessmentResult {
  const repoRoot = resolveRepoRoot(input);
  const storePath = resolve(
    repoRoot,
    input.persistenceDir ?? storeOptions.persistenceDir ?? defaultPersistenceDir,
    input.databaseFile ?? storeOptions.databaseFile ?? defaultDatabaseFile,
  );
  let store: TechLeadPersistenceStore | undefined;
  try {
    store = openPersistenceStore(repoRoot, {
      persistenceDir: input.persistenceDir,
      databaseFile: input.databaseFile,
      ...storeOptions,
    });
    const previousRun = store.latestRun();
    const priorAnswers = store.listAnswers();
    const priorDecisions = store.listDecisions();
    const now = input.now ?? new Date().toISOString();
    const runId = makeRunId(now);
    const assessmentInput = buildAssessmentInput(input, repoRoot, priorDecisions, now, runId);
    const normalized = normalizeAssessmentInput(assessmentInput);
    const assessment = applyPriorAnswers(
      assessArchitecture(assessmentInput),
      priorAnswers,
      normalized.telemetry,
      now,
    );
    const openQuestions = filterOpenQuestions(assessment.questions, priorAnswers);
    const diagnostics = diagnosticsForCapture(normalized.telemetry);
    const lifecycleState = lifecycleForCapture({
      previousRunExists: Boolean(previousRun),
      diagnostics,
      openQuestionCount: openQuestions.length,
      reusedState: priorAnswers.length > 0 || priorDecisions.length > 0,
    });
    const snapshot: AssessmentRunSnapshot = {
      runId,
      repoRoot,
      capturedAt: now,
      ...(previousRun ? { previousRunId: previousRun.runId } : {}),
      lifecycleState,
      durableRecordCreated: true,
      assessment: {
        ...assessment,
        questions: openQuestions,
      },
      telemetry: normalized.telemetry,
      input: assessmentInput,
      diagnostics,
    };
    store.saveRun(snapshot);
    const answeredQuestions = priorAnswers.filter((answer) => answer.status === "answered");
    const skippedQuestions = priorAnswers.filter((answer) => answer.status === "skipped");
    const pack: LatestAssessmentPack = {
      run: snapshot,
      ...(previousRun ? { previousRun } : {}),
      openQuestions,
      answeredQuestions,
      skippedQuestions,
      decisions: priorDecisions,
      storePath: store.databasePath,
    };
    const artifactPaths = materializeAssessmentArtifacts(pack, store);
    return {
      durableRecordCreated: true,
      storePath: store.databasePath,
      runId,
      ...(previousRun ? { previousRunId: previousRun.runId } : {}),
      assessment: snapshot.assessment,
      telemetry: normalized.telemetry,
      openQuestions,
      answeredQuestions,
      skippedQuestions,
      decisions: priorDecisions,
      artifactPaths,
      diagnostics,
      lifecycleState,
    };
  } catch (error) {
    const previousRun = store ? safeLatestRun(store) : undefined;
    const diagnostics = diagnosticsFromError(error, store?.databasePath ?? storePath, Boolean(previousRun));
    const answers = safeListAnswers(store);
    return {
      durableRecordCreated: false,
      storePath: store?.databasePath ?? storePath,
      runId: "unavailable",
      assessment: previousRun?.assessment ?? emptyAssessment(repoRoot, diagnostics),
      ...(previousRun?.telemetry ? { telemetry: previousRun.telemetry } : {}),
      openQuestions: previousRun?.assessment.questions ?? [],
      answeredQuestions: answers.filter((answer) => answer.status === "answered"),
      skippedQuestions: answers.filter((answer) => answer.status === "skipped"),
      decisions: safeListDecisions(store),
      diagnostics,
      lifecycleState: previousRun ? "stale_but_valid" : "unavailable",
    };
  } finally {
    store?.close();
  }
}

export function applyPersistedAnswer(
  input: ApplyPersistedAnswerInput,
  storeOptions: StoreOptions = {},
): CaptureAssessmentResult {
  const repoRoot = resolveRepoRoot(input);
  const store = openPersistenceStore(repoRoot, {
    persistenceDir: input.persistenceDir,
    databaseFile: input.databaseFile,
    ...storeOptions,
  });
  try {
    const latest = requireLatestRun(store);
    const question = latest.assessment.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new Error(`Unknown question id ${input.questionId}. Run capture first or check questions.json.`);
    }
    const status = input.status ?? (input.action === "skip" ? "skipped" : "answered");
    const answer: PersistedAnswer = {
      questionId: input.questionId,
      action: input.action,
      answerId: input.answerId ?? makeAnswerId(input.questionId, input.now),
      recordedAt: input.now ?? new Date().toISOString(),
      status,
      source: input.source ?? "host",
      ...(input.value ? { value: input.value } : {}),
      ...(input.note ? { note: input.note } : {}),
      runId: input.runId ?? latest.runId,
    };
    store.appendAnswer(answer);
    const answers = store.listAnswers();
    const decisions = store.listDecisions();
    const assessment = applyPriorAnswers(latest.assessment, answers, latest.telemetry, answer.recordedAt);
    const openQuestions = filterOpenQuestions(assessment.questions, answers);
    const updated: AssessmentRunSnapshot = {
      ...latest,
      lifecycleState: openQuestions.length > 0 ? "interview_open" : "interview_updated",
      assessment: {
        ...assessment,
        questions: openQuestions,
      },
      diagnostics: latest.diagnostics,
    };
    const pack: LatestAssessmentPack = {
      run: updated,
      openQuestions,
      answeredQuestions: answers.filter((item) => item.status === "answered"),
      skippedQuestions: answers.filter((item) => item.status === "skipped"),
      decisions,
      storePath: store.databasePath,
    };
    const artifactPaths = materializeAssessmentArtifacts(pack, store);
    return resultFromPack(pack, artifactPaths);
  } finally {
    store.close();
  }
}

export function confirmPersistedDecision(
  input: ConfirmPersistedDecisionInput,
  storeOptions: StoreOptions = {},
): CaptureAssessmentResult {
  const repoRoot = resolveRepoRoot(input);
  const store = openPersistenceStore(repoRoot, {
    persistenceDir: input.persistenceDir,
    databaseFile: input.databaseFile,
    ...storeOptions,
  });
  try {
    const latest = requireLatestRun(store);
    store.appendDecision({
      ...input,
      repoRoot,
      runId: input.runId ?? latest.runId,
    });
    const answers = store.listAnswers();
    const decisions = store.listDecisions();
    const updated: AssessmentRunSnapshot = {
      ...latest,
      lifecycleState: "decision_confirmed",
    };
    const pack: LatestAssessmentPack = {
      run: updated,
      openQuestions: latest.assessment.questions,
      answeredQuestions: answers.filter((item) => item.status === "answered"),
      skippedQuestions: answers.filter((item) => item.status === "skipped"),
      decisions,
      storePath: store.databasePath,
    };
    const artifactPaths = materializeAssessmentArtifacts(pack, store);
    return resultFromPack(pack, artifactPaths);
  } finally {
    store.close();
  }
}

function buildAssessmentInput(
  input: CaptureAssessmentInput,
  repoRoot: string,
  persistedDecisions: DecisionRecord[],
  capturedAt: string,
  correlationId: string,
): AssessmentInput | Record<string, unknown> {
  const memoryRecords = [
    ...(input.memoryRecords ?? []),
    ...persistedDecisions,
  ];
  if (input.telemetry) {
    return {
      telemetry: input.telemetry,
      memoryRecords,
    };
  }
  if (input.event) {
    return {
      event: {
        ...input.event,
        cwd: typeof input.event.cwd === "string" ? input.event.cwd : repoRoot,
      },
      memoryRecords,
    };
  }
  const collected = collectRepositoryTelemetry({
    repoRoot,
    request: input.request ?? defaultCaptureRequest,
    capturedAt,
    correlationId,
  });
  return {
    event: {
      ...collected.event,
      memoryRefs: persistedDecisions.map((decision) => decision.id),
    },
    telemetry: collected.telemetry,
    memoryRecords,
  };
}

function applyPriorAnswers(
  assessment: AssessmentResult,
  answers: PersistedAnswer[],
  telemetry: ArchitecturalTelemetryBundle | undefined,
  recordedAt: string,
): AssessmentResult {
  if (answers.length === 0) {
    return assessment;
  }
  const mergeableAnswers: BaselineAnswer[] = answers.map((answer) => ({
    questionId: answer.questionId,
    action: answer.action,
    ...(answer.value ? { value: answer.value } : {}),
    ...(answer.note ? { note: answer.note } : {}),
    answerId: answer.answerId,
    recordedAt: answer.recordedAt,
  }));
  const baseline = applyBaselineAnswers({
    baseline: assessment.baseline,
    questions: assessment.questions,
    answers: mergeableAnswers,
    recordedAt,
  });
  const questions = planBaselineInterviewQuestions({ baseline, telemetry });
  return {
    ...assessment,
    baseline,
    questions,
  };
}

function filterOpenQuestions(
  questions: BaselineQuestion[],
  answers: PersistedAnswer[],
): BaselineQuestion[] {
  const closed = new Set(answers.map((answer) => answer.questionId));
  return questions.filter((question) => !closed.has(question.id));
}

function resultFromPack(
  pack: LatestAssessmentPack,
  artifactPaths: CaptureAssessmentResult["artifactPaths"],
): CaptureAssessmentResult {
  return {
    durableRecordCreated: true,
    storePath: pack.storePath,
    runId: pack.run.runId,
    ...(pack.run.previousRunId ? { previousRunId: pack.run.previousRunId } : {}),
    assessment: pack.run.assessment,
    ...(pack.run.telemetry ? { telemetry: pack.run.telemetry } : {}),
    openQuestions: pack.openQuestions,
    answeredQuestions: pack.answeredQuestions,
    skippedQuestions: pack.skippedQuestions,
    decisions: pack.decisions,
    artifactPaths,
    diagnostics: pack.run.diagnostics,
    lifecycleState: pack.run.lifecycleState,
  };
}

function resolveRepoRoot(input: { repoRoot?: string; cwd?: string; event?: Record<string, unknown>; telemetry?: ArchitecturalTelemetryBundle }): string {
  if (input.repoRoot) {
    return resolve(input.repoRoot);
  }
  if (input.cwd) {
    return resolve(input.cwd);
  }
  if (input.event) {
    const rawCwd = typeof input.event.cwd === "string" ? input.event.cwd : undefined;
    if (rawCwd) {
      return resolve(rawCwd);
    }
  }
  const lifecycleCwd = input.telemetry?.lifecycle.find((signal) => signal.payload.cwd)?.payload.cwd;
  if (lifecycleCwd) {
    return resolve(lifecycleCwd);
  }
  throw new Error("repoRoot or cwd is required for durable capture.");
}

function diagnosticsForCapture(telemetry: ArchitecturalTelemetryBundle): PersistenceDiagnostic[] {
  return telemetry.diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
  }));
}

function diagnosticsFromError(
  error: unknown,
  source: string,
  priorRecordExists: boolean,
): PersistenceDiagnostic[] {
  if (error instanceof PersistenceStoreError) {
    return error.diagnostics;
  }
  return [{
    id: priorRecordExists ? "persistence-stale-but-valid" : "persistence-unavailable",
    severity: "error",
    source,
    message: error instanceof Error ? error.message : String(error),
  }];
}

function safeLatestRun(store: TechLeadPersistenceStore): AssessmentRunSnapshot | undefined {
  try {
    return store.latestRun();
  } catch {
    return undefined;
  }
}

function safeListAnswers(store: TechLeadPersistenceStore | undefined): PersistedAnswer[] {
  try {
    return store?.listAnswers() ?? [];
  } catch {
    return [];
  }
}

function safeListDecisions(store: TechLeadPersistenceStore | undefined): DecisionRecord[] {
  try {
    return store?.listDecisions() ?? [];
  } catch {
    return [];
  }
}

function requireLatestRun(store: TechLeadPersistenceStore): AssessmentRunSnapshot {
  const latest = store.latestRun();
  if (!latest) {
    throw new Error("No persisted assessment exists. Run archcoach capture first.");
  }
  return latest;
}

function emptyAssessment(repoRoot: string, diagnostics: PersistenceDiagnostic[]): AssessmentResult {
  return {
    status: "needs_attention",
    intervention: "recommend",
    action: "Record decision",
    reason: "No durable assessment could be created.",
    evidence: [],
    doNotAdd: ["Do not rely on this assessment until persistence succeeds."],
    memory: { status: "absent", decisionCount: 0 },
    baseline: {
      repoRoot,
      generatedAt: new Date().toISOString(),
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: diagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        severity: diagnostic.severity,
        source: diagnostic.source,
        message: diagnostic.message,
      })),
    },
    questions: [],
    revisitAlerts: [],
    principleGuidance: [],
  };
}

function makeRunId(now: string): string {
  return `run-${now.replace(/[^0-9A-Za-z]+/g, "-").replace(/-+$/g, "")}`;
}

function makeAnswerId(questionId: string, now = new Date().toISOString()): string {
  return `answer-${questionId}-${now}`.replace(/[^0-9A-Za-z_-]+/g, "-");
}
