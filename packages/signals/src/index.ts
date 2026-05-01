import type { SignalStatus } from "../../kernel/src/protocol.js";

export type EvidenceCategory =
  | "file_layout"
  | "architecture_shape"
  | "changed_file_spread"
  | "import_relationship"
  | "symbol_reference"
  | "configuration_boundary"
  | "test_posture"
  | "diagnostic"
  | "runtime_error"
  | "monitor_event"
  | "history_interaction";

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
  interactionGuidance?: unknown;
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
export * from "./architectureShape.js";
export * from "./codeIntelligence.js";
export * from "./codeIntelligenceTypes.js";
export * from "./diagnostics.js";
export * from "./fileTree.js";
export * from "./gitDiff.js";
export * from "./gitHistory.js";
export * from "./historyProviders.js";
export * from "./historyTypes.js";
export * from "./providerRunner.js";
export * from "./runtime.js";
export * from "./transcripts.js";
export * from "./ceetrixHistory.js";
