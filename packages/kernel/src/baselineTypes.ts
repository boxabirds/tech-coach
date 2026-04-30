import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  MaturityState,
  OptionalSignalSummary,
  ProtocolValidationIssue,
} from "./protocol.js";
import type { OptionalSignalResult } from "../../signals/src/index.js";
import type { ArchitecturalTelemetryBundle } from "./telemetryTypes.js";

export type BaselineFactStatus =
  | "observed"
  | "inferred"
  | "user_confirmed"
  | "unknown";

export type BaselineConfidence = "low" | "medium" | "high";
export type AxisScore = "low" | "medium" | "high" | "unknown";
export type BaselineFreshness = "current" | "stale" | "unknown";

export type ThresholdCandidate =
  | "repetition"
  | "state_ownership"
  | "persistence"
  | "identity"
  | "collaboration"
  | "public_api"
  | "deployment"
  | "operational"
  | "security"
  | "blast_radius"
  | "revisit";

export type ArchitectureConcern =
  | "application_shape"
  | "package_boundary"
  | "entrypoint"
  | "state_ownership"
  | "data_storage"
  | "authentication"
  | "authorization"
  | "deployment"
  | "api_contract"
  | "background_job"
  | "testing"
  | "observability"
  | "risk_hotspot"
  | "unknown";

export type EvidenceSourceRef = {
  source: string;
  category: string;
  status: "present" | "absent" | "failed";
  freshness: BaselineFreshness;
  confidence: BaselineConfidence;
};

export type BaselineFact = {
  id: string;
  concern: ArchitectureConcern;
  label: string;
  status: BaselineFactStatus;
  confidence: BaselineConfidence;
  freshness: BaselineFreshness;
  sources: EvidenceSourceRef[];
  summary: string;
};

export type BaselineUnknown = {
  id: string;
  concern: ArchitectureConcern;
  reason: string;
  neededEvidence: string[];
};

export type BaselineDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  source?: string;
};

export type DecisionAxisAssessment = {
  complexity: AxisScore;
  irreversibility: AxisScore;
  solutionVisibility: AxisScore;
  planningHorizon: AxisScore;
};

export type BaselineConcernAssessment = {
  concern: ArchitectureConcern;
  currentState: MaturityState;
  confidence: BaselineConfidence;
  axes: DecisionAxisAssessment;
  thresholdCandidates: ThresholdCandidate[];
  facts: BaselineFact[];
  unknowns: BaselineUnknown[];
  rationale: string;
};

export type BaselineInput = {
  event: CoachEventEnvelope;
  evidence?: Array<OptionalSignalResult | OptionalSignalSummary>;
  telemetry?: ArchitecturalTelemetryBundle;
  priorDecisions?: DecisionRecordSummary[];
};

export type ArchitectureBaseline = {
  repoRoot: string;
  generatedAt: string;
  concerns: BaselineConcernAssessment[];
  facts: BaselineFact[];
  unknowns: BaselineUnknown[];
  diagnostics: BaselineDiagnostic[];
};

export interface ArchitectureBaselineSynthesizer {
  synthesize(input: BaselineInput): ArchitectureBaseline;
}

export class BaselineValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "BaselineValidationError";
    this.issues = issues;
  }
}
