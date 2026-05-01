import { describe, expect, it } from "vitest";
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
  lifecycleForCapture,
} from "./lifecycle.js";

describe("persistence lifecycle", () => {
  it("allows the durable capture path and rejects impossible transitions", () => {
    expect(canTransitionLifecycle("not_started", "capturing")).toBe(true);
    expect(canTransitionLifecycle("capturing", "captured")).toBe(true);
    expect(canTransitionLifecycle("captured", "interview_open")).toBe(true);
    expect(canTransitionLifecycle("interview_open", "interview_updated")).toBe(true);
    expect(canTransitionLifecycle("interview_updated", "decision_confirmed")).toBe(true);
    expect(canTransitionLifecycle("decision_confirmed", "rerun_reused")).toBe(true);

    expect(() => assertLifecycleTransition("not_started", "decision_confirmed"))
      .toThrow(/Invalid persistence lifecycle transition/);
  });

  it("classifies capture outcomes from evidence, questions, and reused state", () => {
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [],
      openQuestionCount: 0,
      reusedState: false,
    })).toBe("captured");
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [],
      openQuestionCount: 2,
      reusedState: false,
    })).toBe("interview_open");
    expect(lifecycleForCapture({
      previousRunExists: false,
      diagnostics: [{ severity: "warning" }],
      openQuestionCount: 0,
      reusedState: false,
    })).toBe("partial_capture");
    expect(lifecycleForCapture({
      previousRunExists: true,
      diagnostics: [],
      openQuestionCount: 0,
      reusedState: true,
    })).toBe("rerun_reused");
  });
});
