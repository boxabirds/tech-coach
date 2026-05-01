import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

export const diagnosticsProvider: OptionalSignalProvider = {
  name: "diagnostics",
  collect(context: SignalContext): OptionalSignalResult[] {
    const signals: OptionalSignalResult[] = [];

    if (context.testSummary?.summary || context.testSummary?.status) {
      signals.push({
        source: "diagnostics",
        status: "present",
        category: "test_posture",
        freshness: "current",
        confidence: context.testSummary.status && context.testSummary.status !== "unknown" ? "medium" : "low",
        evidence: [
          context.testSummary.status ? `test status: ${context.testSummary.status}` : undefined,
          context.testSummary.summary,
        ].filter((item): item is string => typeof item === "string" && item.length > 0),
      });
    }

    if (context.diagnostics && context.diagnostics.length > 0) {
      signals.push({
        source: "diagnostics",
        status: "present",
        category: "diagnostic",
        freshness: "current",
        confidence: "medium",
        evidence: context.diagnostics,
      });
    }

    return signals.length > 0
      ? signals
      : [{
        source: "diagnostics",
        status: "absent",
        category: "diagnostic",
        freshness: "unknown",
        confidence: "low",
        evidence: [],
        error: "no diagnostic or test summary supplied",
      }];
  },
};
