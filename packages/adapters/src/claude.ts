import { assessArchitecture, type AssessmentResult } from "../../kernel/src/assessment.js";
import { normalizeHostEvent } from "../../kernel/src/normalize.js";
import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  OptionalSignalSummary,
  RepoSignalSummary,
  TestSummary,
} from "../../kernel/src/protocol.js";
import {
  assertValidTelemetryBundle,
  telemetryFromEvent,
} from "../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";

export type ClaudeCodeEventInput = {
  cwd?: string;
  working_directory?: string;
  hook_event_name?: string;
  kind?: string;
  event?: string;
  prompt?: string;
  userPrompt?: string;
  user_request?: string;
  payload?: { prompt?: string };
  changed_files?: string[];
  changedFiles?: string[];
  recentRequests?: string[];
  repoSignals?: RepoSignalSummary;
  testSummary?: TestSummary;
  memoryRefs?: string[];
  priorDecisions?: DecisionRecordSummary[];
  optionalSignals?: OptionalSignalSummary[];
  telemetry?: ArchitecturalTelemetryBundle;
};

export type ClaudeAdapterAssessment = {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  assessment: AssessmentResult;
};

export function normalizeClaudeCodeEvent(input: ClaudeCodeEventInput): CoachEventEnvelope {
  return normalizeHostEvent({
    host: "claude-code",
    event: input.hook_event_name ?? input.kind ?? input.event ?? "PostToolBatch",
    cwd: input.cwd ?? input.working_directory,
    userRequest: input.prompt ?? input.userPrompt ?? input.user_request ?? input.payload?.prompt,
    recentRequests: input.recentRequests ?? [],
    changedFiles: input.changedFiles ?? input.changed_files ?? [],
    repoSignals: input.repoSignals ?? { status: "absent" },
    testSummary: input.testSummary,
    memoryRefs: input.memoryRefs ?? [],
    priorDecisions: input.priorDecisions ?? [],
    optionalSignals: input.optionalSignals ?? [],
  });
}

export function assessClaudeCodeEvent(input: ClaudeCodeEventInput): ClaudeAdapterAssessment {
  const event = normalizeClaudeCodeEvent(input);
  const telemetry = input.telemetry
    ? assertValidTelemetryBundle(input.telemetry)
    : telemetryFromEvent(event);
  return {
    event,
    telemetry,
    assessment: assessArchitecture({ event, telemetry }),
  };
}
