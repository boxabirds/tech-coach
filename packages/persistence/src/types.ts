import type { AssessmentInput, AssessmentResult } from "../../kernel/src/assessment.js";
import type { BaselineAnswer, BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import type { DecisionRecord } from "../../kernel/src/memory.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { UsageEvent } from "../../kernel/src/usageEvents.js";

export const defaultPersistenceDir = ".ceetrix/tech-lead";
export const defaultDatabaseFile = "tech-lead.db";

export type PersistenceLifecycleState =
  | "not_started"
  | "capturing"
  | "partial_capture"
  | "captured"
  | "interview_open"
  | "interview_updated"
  | "decision_confirmed"
  | "rerun_reused"
  | "stale_but_valid"
  | "unavailable";

export type PersistenceDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  source?: string;
};

export type LifecycleAuditRecord = {
  auditId: string;
  repoRoot: string;
  kind: string;
  mode: "advisory" | "balanced" | "strict";
  effect: "none" | "inject" | "block";
  createdAt: string;
  correlationId: string;
  action?: string;
  intervention?: string;
  reason?: string;
  evidence: string[];
  questionIds: string[];
  degraded: boolean;
};

export type PersistedQuestionState = "open" | "answered" | "skipped" | "obsolete";

export type PersistedAnswer = BaselineAnswer & {
  answerId: string;
  questionId: string;
  runId?: string;
  status: "answered" | "skipped";
  recordedAt: string;
  source?: "user" | "host" | "test";
  diagnostics?: PersistenceDiagnostic[];
};

export type PersistedDecision = DecisionRecord & {
  runId?: string;
  confirmedAt?: string;
};

export type ArtifactPaths = {
  latestAssessmentMd: string;
  latestAssessmentJson: string;
  questionsJson: string;
  evidenceJson: string;
  nextActionsMd: string;
  decisionsJsonl: string;
  changesSinceLastMd: string;
};

export type AssessmentRunSnapshot = {
  runId: string;
  repoRoot: string;
  capturedAt: string;
  previousRunId?: string;
  lifecycleState: PersistenceLifecycleState;
  durableRecordCreated: boolean;
  assessment: AssessmentResult;
  telemetry?: ArchitecturalTelemetryBundle;
  input?: AssessmentInput | Record<string, unknown>;
  diagnostics: PersistenceDiagnostic[];
};

export type LatestAssessmentPack = {
  run: AssessmentRunSnapshot;
  previousRun?: AssessmentRunSnapshot;
  openQuestions: BaselineQuestion[];
  answeredQuestions: PersistedAnswer[];
  skippedQuestions: PersistedAnswer[];
  decisions: PersistedDecision[];
  artifacts?: ArtifactPaths;
  storePath: string;
};

export type UsageEventQuery = {
  repoId?: string;
  repoRoot?: string;
  sessionId?: string;
  since?: string;
  until?: string;
};

export type PersistedUsageEvent = UsageEvent;

export type CaptureAssessmentInput = {
  repoRoot?: string;
  cwd?: string;
  event?: Record<string, unknown>;
  telemetry?: ArchitecturalTelemetryBundle;
  memoryRecords?: DecisionRecord[];
  request?: string;
  output?: "text" | "json";
  persistenceDir?: string;
  databaseFile?: string;
  now?: string;
};

export type CaptureAssessmentResult = {
  durableRecordCreated: boolean;
  storePath: string;
  runId: string;
  previousRunId?: string;
  assessment: AssessmentResult;
  telemetry?: ArchitecturalTelemetryBundle;
  openQuestions: BaselineQuestion[];
  answeredQuestions: PersistedAnswer[];
  skippedQuestions: PersistedAnswer[];
  decisions: PersistedDecision[];
  artifactPaths?: ArtifactPaths;
  diagnostics: PersistenceDiagnostic[];
  lifecycleState: PersistenceLifecycleState;
};

export type ApplyPersistedAnswerInput = {
  repoRoot?: string;
  cwd?: string;
  questionId: string;
  action: BaselineAnswer["action"];
  value?: string;
  note?: string;
  answerId?: string;
  runId?: string;
  status?: "answered" | "skipped";
  source?: PersistedAnswer["source"];
  persistenceDir?: string;
  databaseFile?: string;
  now?: string;
};

export type ConfirmPersistedDecisionInput = {
  repoRoot?: string;
  cwd?: string;
  decision: DecisionRecord;
  runId?: string;
  confirmed?: boolean;
  persistenceDir?: string;
  databaseFile?: string;
  now?: string;
};
