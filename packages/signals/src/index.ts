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
};

export type SignalContext = {
  cwd: string;
  changedFiles: string[];
  userRequest?: string;
  recentRequests: string[];
};

export interface OptionalSignalProvider {
  collect(context: SignalContext): OptionalSignalResult;
}
