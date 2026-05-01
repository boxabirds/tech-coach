import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

export const runtimeProvider: OptionalSignalProvider = {
  name: "runtime",
  collect(context: SignalContext): OptionalSignalResult[] {
    const signals: OptionalSignalResult[] = [];
    if (context.runtimeErrors && context.runtimeErrors.length > 0) {
      signals.push({
        source: "runtime",
        status: "present",
        category: "runtime_error",
        freshness: "current",
        confidence: "medium",
        evidence: context.runtimeErrors,
      });
    }

    if (context.monitorEvents && context.monitorEvents.length > 0) {
      signals.push({
        source: "runtime",
        status: "present",
        category: "monitor_event",
        freshness: "current",
        confidence: "medium",
        evidence: context.monitorEvents,
      });
    }

    return signals.length > 0
      ? signals
      : [{
        source: "runtime",
        status: "absent",
        category: "monitor_event",
        freshness: "unknown",
        confidence: "low",
        evidence: [],
        error: "no runtime or monitor events supplied",
      }];
  },
};
