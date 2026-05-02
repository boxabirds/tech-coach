import type { PersistenceLifecycleState } from "./types.js";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { LifecycleAuditRecord } from "./types.js";

export type LifecycleTransition = {
  from: PersistenceLifecycleState;
  to: PersistenceLifecycleState;
};

const allowedTransitions: Record<PersistenceLifecycleState, PersistenceLifecycleState[]> = {
  not_started: ["capturing"],
  capturing: ["partial_capture", "captured", "unavailable"],
  partial_capture: ["captured", "unavailable"],
  captured: ["interview_open", "rerun_reused", "stale_but_valid", "capturing"],
  interview_open: ["interview_updated", "stale_but_valid"],
  interview_updated: ["decision_confirmed", "rerun_reused", "stale_but_valid", "capturing"],
  decision_confirmed: ["rerun_reused", "stale_but_valid", "capturing"],
  rerun_reused: ["interview_open", "interview_updated", "decision_confirmed", "stale_but_valid", "capturing"],
  stale_but_valid: ["capturing"],
  unavailable: ["capturing"],
};

export function canTransitionLifecycle(
  from: PersistenceLifecycleState,
  to: PersistenceLifecycleState,
): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function assertLifecycleTransition(
  from: PersistenceLifecycleState,
  to: PersistenceLifecycleState,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new Error(`Invalid persistence lifecycle transition: ${from} -> ${to}`);
  }
}

export function lifecycleForCapture(input: {
  previousRunExists: boolean;
  diagnostics: Array<{ severity: "info" | "warning" | "error" }>;
  openQuestionCount: number;
  reusedState: boolean;
}): PersistenceLifecycleState {
  if (input.reusedState) {
    return "rerun_reused";
  }
  if (input.openQuestionCount > 0) {
    return "interview_open";
  }
  if (input.diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "partial_capture";
  }
  return "captured";
}

export function buildLifecycleAuditRecord(input: {
  kind: string;
  repoRoot: string;
  mode: LifecycleAuditRecord["mode"];
  effect: LifecycleAuditRecord["effect"];
  createdAt: string;
  reason?: string;
  assessment?: AssessmentResult;
  telemetry?: ArchitecturalTelemetryBundle;
  degraded?: boolean;
}): LifecycleAuditRecord {
  const correlationId = input.telemetry?.lifecycle.find((signal) => signal.correlationId)
    ?.correlationId
    ?? `${input.kind}-${input.createdAt}`;
  return {
    auditId: makeAuditId(input.kind, input.createdAt, correlationId),
    repoRoot: input.repoRoot,
    kind: input.kind,
    mode: input.mode,
    effect: input.effect,
    createdAt: input.createdAt,
    correlationId,
    ...(input.assessment?.action ? { action: input.assessment.action } : {}),
    ...(input.assessment?.intervention ? { intervention: input.assessment.intervention } : {}),
    ...(input.reason ?? input.assessment?.reason
      ? { reason: compact(input.reason ?? input.assessment?.reason ?? "") }
      : {}),
    evidence: (input.assessment?.evidence ?? [])
      .map((item) => compact(item.summary))
      .filter((item) => item.length > 0)
      .slice(0, 5),
    questionIds: (input.assessment?.questions ?? [])
      .map((question) => question.id)
      .slice(0, 5),
    degraded: input.degraded === true,
  };
}

function makeAuditId(kind: string, createdAt: string, correlationId: string): string {
  return `lifecycle-${kind}-${correlationId}-${createdAt}`
    .replace(/[^0-9A-Za-z_-]+/g, "-")
    .replace(/-+$/g, "");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}
