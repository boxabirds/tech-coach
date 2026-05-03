import type { ArchitectureConcern, BaselineConfidence, BaselineFreshness } from "./baselineTypes.js";
import type { SignalFamily } from "./telemetryTypes.js";

export type ClaimEvidenceFamily =
  | "route"
  | "external_provider"
  | "session"
  | "credential"
  | "authorization"
  | "schema"
  | "binding"
  | "deployment_config"
  | "package_boundary"
  | "runtime_boundary"
  | "test_surface"
  | "observability"
  | "unknown";

export type ArchitectureFactProvenance = {
  path?: string;
  line?: number;
  excerpt?: string;
  symbol?: string;
};

export type ArchitectureFactRelationship = {
  type:
    | "imports"
    | "exports"
    | "uses_binding"
    | "configured_by"
    | "documented_by"
    | "tested_by"
    | "runs_in"
    | "depends_on";
  target: string;
  label?: string;
};

export type EvidenceTimeframe = "past" | "current" | "future" | "uncertain";

export type EvidenceRole =
  | "architecture_basis"
  | "implementation"
  | "experiment"
  | "decision_record"
  | "test_evidence"
  | "work_in_progress"
  | "repository_shape";

export type ArchitectureFactKind =
  | "inventory.file"
  | "inventory.excluded"
  | "deployment.environment"
  | "deployment.runtime"
  | "deployment.script"
  | "binding.d1"
  | "binding.kv"
  | "binding.durable_object"
  | "storage.schema"
  | "auth.github_oauth"
  | "auth.session"
  | "auth.credential"
  | "authz.membership_role"
  | "package.workspace"
  | "runtime.boundary"
  | "code.import"
  | "code.symbol"
  | "test.surface"
  | "observability.signal"
  | "doc.runbook"
  | "doc.architecture"
  | "diagnostic";

export type ArchitectureEvidenceFact = {
  id: string;
  concern: ArchitectureConcern;
  family: ClaimEvidenceFamily;
  kind: ArchitectureFactKind;
  label: string;
  summary: string;
  source: string;
  confidence: BaselineConfidence;
  freshness: BaselineFreshness;
  provenance: ArchitectureFactProvenance[];
  relationships?: ArchitectureFactRelationship[];
  metadata?: Record<string, unknown>;
  timeframe?: EvidenceTimeframe;
  role?: EvidenceRole;
};

export type ArchitectureEvidenceNode = {
  id: string;
  concern: ArchitectureConcern;
  family: ClaimEvidenceFamily;
  label: string;
  summary: string;
  citations: string[];
  factId?: string;
  factKind?: ArchitectureFactKind;
  provenance?: ArchitectureFactProvenance[];
  signalFamily: SignalFamily;
  signalId: string;
  source: string;
  confidence: BaselineConfidence;
  freshness: BaselineFreshness;
  timeframe?: EvidenceTimeframe;
  role?: EvidenceRole;
};

export type ArchitectureEvidenceGraph = {
  nodes: ArchitectureEvidenceNode[];
  facts: ArchitectureEvidenceFact[];
  diagnostics: string[];
};

export type ArchitectureClaim = {
  id: string;
  concern: ArchitectureConcern;
  subject: string;
  claim: string;
  confidence: BaselineConfidence;
  evidenceNodeIds: string[];
  evidence: string[];
  counterEvidence: string[];
  residualUnknowns: string[];
};
