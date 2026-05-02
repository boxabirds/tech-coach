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

export type GenericCiEventInput = {
  cwd?: string;
  repoRoot?: string;
  workingDirectory?: string;
  event?: string;
  kind?: string;
  userRequest?: string;
  prompt?: string;
  recentRequests?: string[];
  changedFiles?: string[];
  repoSignals?: RepoSignalSummary;
  testSummary?: TestSummary;
  memoryRefs?: string[];
  priorDecisions?: DecisionRecordSummary[];
  optionalSignals?: OptionalSignalSummary[];
  telemetry?: ArchitecturalTelemetryBundle;
};

export type AdapterAssessment = {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
  assessment: AssessmentResult;
};

export function normalizeGenericCiEvent(input: GenericCiEventInput): CoachEventEnvelope {
  return normalizeHostEvent({
    host: "generic-ci",
    event: input.event ?? input.kind ?? "ci-check",
    cwd: input.cwd ?? input.repoRoot ?? input.workingDirectory,
    userRequest: input.userRequest ?? input.prompt,
    recentRequests: input.recentRequests ?? [],
    changedFiles: input.changedFiles ?? [],
    repoSignals: input.repoSignals ?? { status: "absent" },
    testSummary: input.testSummary,
    memoryRefs: input.memoryRefs ?? [],
    priorDecisions: input.priorDecisions ?? [],
    optionalSignals: input.optionalSignals ?? [],
  });
}

export function assessGenericCiEvent(input: GenericCiEventInput): AdapterAssessment {
  const event = normalizeGenericCiEvent(input);
  const telemetry = input.telemetry
    ? assertValidTelemetryBundle(input.telemetry)
    : telemetryFromEvent(event);
  return {
    event,
    telemetry,
    assessment: assessArchitecture({ event, telemetry }),
  };
}
