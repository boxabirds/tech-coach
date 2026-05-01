import type { PersistenceLifecycleState } from "./types.js";

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
