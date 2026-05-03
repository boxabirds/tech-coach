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

export type CodexEventInput = {
  cwd?: string;
  repoRoot?: string;
  working_directory?: string;
  hook_event_name?: string;
  kind?: string;
  event?: string;
  prompt?: string;
  userRequest?: string;
  user_prompt?: string;
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

export type CodexAdapterAssessment = {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  assessment: AssessmentResult;
};

export function normalizeCodexEvent(input: CodexEventInput): CoachEventEnvelope {
  return normalizeHostEvent({
    host: "codex",
    event: input.hook_event_name ?? input.kind ?? input.event ?? "UserPromptSubmit",
    cwd: input.cwd ?? input.repoRoot ?? input.working_directory,
    userRequest: input.prompt ?? input.userRequest ?? input.user_prompt,
    recentRequests: input.recentRequests ?? [],
    changedFiles: input.changedFiles ?? input.changed_files ?? [],
    repoSignals: input.repoSignals ?? { status: "absent" },
    testSummary: input.testSummary,
    memoryRefs: input.memoryRefs ?? [],
    priorDecisions: input.priorDecisions ?? [],
    optionalSignals: input.optionalSignals ?? [],
  });
}

export function assessCodexEvent(input: CodexEventInput): CodexAdapterAssessment {
  const event = normalizeCodexEvent(input);
  const telemetry = input.telemetry
    ? assertValidTelemetryBundle(input.telemetry)
    : telemetryFromEvent(event);
  return {
    event,
    telemetry,
    assessment: assessArchitecture({ event, telemetry }),
  };
}
