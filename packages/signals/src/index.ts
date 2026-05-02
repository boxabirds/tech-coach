import type { SignalStatus } from "../../kernel/src/protocol.js";
import type { ArchitectureEvidenceFact } from "../../kernel/src/claimTypes.js";

export type EvidenceCategory =
  | "file_layout"
  | "architecture_shape"
  | "changed_file_spread"
  | "import_relationship"
  | "symbol_reference"
  | "architecture_claim"
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
  details?: Record<string, unknown>;
  facts?: ArchitectureEvidenceFact[];
  interactionGuidance?: unknown;
};

export type ProjectInventoryEntry = {
  path: string;
  status: "included" | "excluded";
  reason?: string;
  source: "git" | "walk" | "changed";
};

export type ProjectInventory = {
  files: string[];
  entries: ProjectInventoryEntry[];
  excluded: ProjectInventoryEntry[];
  totalObserved: number;
  complete: boolean;
  maxFiles: number;
  source: "git" | "walk";
  diagnostics: string[];
};

export type SignalContext = {
  cwd: string;
  changedFiles: string[];
  userRequest?: string;
  recentRequests: string[];
  knownFiles?: string[];
  inventory?: ProjectInventory;
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
export * from "./claimCandidates.js";
export * from "./codeIntelligence.js";
export * from "./codeIntelligenceTypes.js";
export * from "./documentation.js";
export * from "./diagnostics.js";
export * from "./fileTree.js";
export * from "./gitDiff.js";
export * from "./gitHistory.js";
export * from "./historyProviders.js";
export * from "./historyTypes.js";
export * from "./inventory.js";
export * from "./providerRunner.js";
export * from "./runtime.js";
export * from "./transcripts.js";
export * from "./ceetrixHistory.js";
