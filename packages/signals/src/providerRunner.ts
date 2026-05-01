import {
  telemetryFromEvidence,
  validateTelemetryBundle,
} from "../../kernel/src/telemetry.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalFamily,
  TelemetryDiagnostic,
} from "../../kernel/src/telemetryTypes.js";
import type {
  EvidenceCategory,
  OptionalSignalProvider,
  OptionalSignalResult,
  SignalContext,
} from "./index.js";

export type OptionalProviderRunResult = {
  evidence: OptionalSignalResult[];
  telemetry: ArchitecturalTelemetryBundle;
  diagnostics: TelemetryDiagnostic[];
};

export type OptionalProviderRunOptions = {
  timeoutMs?: number;
  capturedAt?: string;
  correlationId?: string;
};

const validCategories = new Set<EvidenceCategory>([
  "file_layout",
  "architecture_shape",
  "changed_file_spread",
  "import_relationship",
  "symbol_reference",
  "configuration_boundary",
  "test_posture",
  "diagnostic",
  "runtime_error",
  "monitor_event",
  "history_interaction",
]);

export async function runOptionalSignalProviders(
  context: SignalContext,
  providers: OptionalSignalProvider[],
  options: OptionalProviderRunOptions = {},
): Promise<OptionalProviderRunResult> {
  const evidence: OptionalSignalResult[] = [];
  const diagnostics: TelemetryDiagnostic[] = [];
  const seenEvidence = new Set<string>();

  for (const provider of providers) {
    const source = provider.name ?? provider.constructor?.name ?? "optional-provider";
    try {
      const output = await withTimeout(
        Promise.resolve(provider.collect(context)),
        options.timeoutMs,
        source,
      );
      for (const signal of normalizeProviderOutput(output, source, diagnostics)) {
        const family = familyForCategory(signal.category);
        if (signal.family && signal.family !== family) {
          diagnostics.push({
            id: diagnosticId(source, signal.category, "family-mismatch"),
            severity: "warning",
            family,
            source,
            message: `${source} reported ${signal.category} as ${signal.family}; expected ${family}`,
          });
          continue;
        }

        const key = [
          signal.source,
          signal.category,
          signal.status,
          signal.evidence.join("\n"),
        ].join("::");
        if (seenEvidence.has(key)) {
          diagnostics.push({
            id: diagnosticId(source, signal.category, "duplicate"),
            severity: "info",
            family,
            source,
            message: `${source} produced duplicate ${signal.category} evidence`,
          });
          continue;
        }
        seenEvidence.add(key);
        evidence.push(signal);
      }
    } catch (error) {
      diagnostics.push({
        id: diagnosticId(source, "provider", "failed"),
        severity: String(error).includes("timed out") ? "warning" : "error",
        source,
        message: error instanceof Error ? error.message : String(error),
      });
      evidence.push({
        source,
        status: "failed",
        category: "diagnostic",
        freshness: "unknown",
        confidence: "low",
        evidence: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const telemetry = telemetryFromEvidence({
    evidence,
    capturedAt: options.capturedAt,
    correlationId: options.correlationId,
  });
  telemetry.diagnostics.push(...diagnostics);
  const validation = validateTelemetryBundle(telemetry);
  if (!validation.valid) {
    telemetry.diagnostics.push(
      ...validation.issues.map((issue, index) => ({
        id: `diagnostic-provider-runner-validation-${index}`,
        severity: "error" as const,
        source: "providerRunner",
        message: `${issue.field}: ${issue.message}`,
      })),
    );
  }

  return { evidence, telemetry, diagnostics };
}

function normalizeProviderOutput(
  output: OptionalSignalResult | OptionalSignalResult[] | undefined | null,
  source: string,
  diagnostics: TelemetryDiagnostic[],
): OptionalSignalResult[] {
  if (output === undefined || output === null) {
    diagnostics.push({
      id: diagnosticId(source, "provider", "absent"),
      severity: "info",
      source,
      message: `${source} returned no optional evidence`,
    });
    return [];
  }

  const signals = Array.isArray(output) ? output : [output];
  return signals.filter((signal, index): signal is OptionalSignalResult => {
    if (!isOptionalSignalResult(signal)) {
      diagnostics.push({
        id: diagnosticId(source, "provider", `malformed-${index}`),
        severity: "warning",
        source,
        message: `${source} returned malformed optional evidence at index ${index}`,
      });
      return false;
    }
    if (!validCategories.has(signal.category)) {
      diagnostics.push({
        id: diagnosticId(source, String(signal.category), "unsupported-category"),
        severity: "warning",
        source,
        message: `${source} returned unsupported category ${String(signal.category)}`,
      });
      return false;
    }
    return true;
  });
}

function isOptionalSignalResult(value: unknown): value is OptionalSignalResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.source === "string"
    && (value.status === "present" || value.status === "absent" || value.status === "failed")
    && typeof value.category === "string"
    && (value.freshness === "current" || value.freshness === "stale" || value.freshness === "unknown")
    && (value.confidence === "low" || value.confidence === "medium" || value.confidence === "high")
    && Array.isArray(value.evidence)
    && value.evidence.every((item) => typeof item === "string")
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  source: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${source} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function familyForCategory(category: EvidenceCategory): Exclude<SignalFamily, "lifecycle" | "memory"> {
  switch (category) {
    case "file_layout":
    case "architecture_shape":
    case "configuration_boundary":
    case "history_interaction":
      return "repository";
    case "changed_file_spread":
    case "import_relationship":
    case "symbol_reference":
      return "change";
    case "test_posture":
    case "diagnostic":
      return "test";
    case "runtime_error":
    case "monitor_event":
      return "runtime";
  }
}

function diagnosticId(source: string, category: string, suffix: string): string {
  return `diagnostic-${source}-${category}-${suffix}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
