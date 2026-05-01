import type { SignalStatus } from "../../kernel/src/protocol.js";

export type EvidenceCategory =
  | "file_layout"
  | "changed_file_spread"
  | "import_relationship"
  | "symbol_reference"
  | "configuration_boundary"
  | "test_posture"
  | "diagnostic"
  | "runtime_error"
  | "monitor_event";

export type EvidenceFreshness = "current" | "stale" | "unknown";
export type EvidenceConfidence = "low" | "medium" | "high";

export type OptionalSignalResult = {
  source: string;
  status: SignalStatus;
  category: EvidenceCategory;
  freshness: EvidenceFreshness;
  confidence: EvidenceConfidence;
  evidence: string[];
  error?: string;
  family?: string;
};

export type SignalContext = {
  cwd: string;
  changedFiles: string[];
  userRequest?: string;
  recentRequests: string[];
  knownFiles?: string[];
  diagnostics?: string[];
  testSummary?: {
    status?: string;
    summary?: string;
  };
  runtimeErrors?: string[];
  monitorEvents?: string[];
};

export interface OptionalSignalProvider {
  name?: string;
  collect(
    context: SignalContext,
  ):
    | OptionalSignalResult
    | OptionalSignalResult[]
    | undefined
    | null
    | Promise<OptionalSignalResult | OptionalSignalResult[] | undefined | null>;
}

export * from "./config.js";
export * from "./codeIntelligence.js";
export * from "./codeIntelligenceTypes.js";
export * from "./diagnostics.js";
export * from "./fileTree.js";
export * from "./gitDiff.js";
export * from "./providerRunner.js";
export * from "./runtime.js";
