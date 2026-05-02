import type {
  ArchitectureInteractionContext,
  CoachEventEnvelope,
  DecisionRecordSummary,
  MaturityState,
  OptionalSignalSummary,
  ProtocolValidationIssue,
} from "./protocol.js";
import type { OptionalSignalResult } from "../../signals/src/index.js";
import type { InteractionGuidance } from "../../signals/src/historyTypes.js";
import type { ArchitecturalTelemetryBundle } from "./telemetryTypes.js";
import type { ArchitectureClaim } from "./claimTypes.js";

export type BaselineFactStatus =
  | "observed"
  | "inferred"
  | "user_confirmed"
  | "user_corrected"
  | "intentionally_temporary"
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

export type ComplexityPressureDriver =
  | "repetition"
  | "shared_state"
  | "durable_state"
  | "collaboration"
  | "identity"
  | "authorization"
  | "public_access"
  | "concurrency"
  | "external_integration"
  | "operational_runtime"
  | "security_sensitive"
  | "broad_change_surface"
  | "revisit_pressure";

export type ComplexityPressureLevel = "none" | "low" | "medium" | "high";
export type StructuralSupportLevel =
  | "absent"
  | "localized"
  | "named"
  | "bounded"
  | "contracted"
  | "operationalized"
  | "unknown";
export type StructureAdequacyStatus =
  | "adequate"
  | "watch"
  | "under_structured"
  | "over_structured"
  | "unknown";

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
  confirmations?: BaselineConfirmation[];
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

export type BaselineQuestionKind =
  | "confirm"
  | "correct"
  | "choose"
  | "free_text"
  | "skip";

export type BaselineAnswerAction =
  | "confirm"
  | "correct"
  | "mark_temporary"
  | "skip";

export type BaselineConfirmationStatus =
  | "user_confirmed"
  | "user_corrected"
  | "intentionally_temporary"
  | "unresolved";

export type BaselineQuestion = {
  id: string;
  concern: ArchitectureConcern;
  kind: BaselineQuestionKind;
  prompt: string;
  reason: string;
  relatedFactIds: string[];
  relatedUnknownIds: string[];
  relatedSignalIds: string[];
  options?: string[];
  interactionGuidance?: InteractionGuidance;
};

export type BaselineAnswer = {
  questionId: string;
  action: BaselineAnswerAction;
  value?: string;
  note?: string;
  answerId?: string;
  recordedAt?: string;
};

export type BaselineConfirmation = {
  factId: string;
  questionId: string;
  status: BaselineConfirmationStatus;
  answerId: string;
  recordedAt: string;
  value?: string;
  note?: string;
};

export type BaselineInterviewInput = {
  baseline: ArchitectureBaseline;
  telemetry?: ArchitecturalTelemetryBundle;
  claims?: ArchitectureClaim[];
  interactionContext?: ArchitectureInteractionContext;
};

export type BaselineAnswerMergeInput = {
  baseline: ArchitectureBaseline;
  questions: BaselineQuestion[];
  answers: BaselineAnswer[];
  recordedAt?: string;
};

export type DecisionAxisAssessment = {
  complexity: AxisScore;
  irreversibility: AxisScore;
  solutionVisibility: AxisScore;
  planningHorizon: AxisScore;
};

export type ComplexityPressureAssessment = {
  concern: ArchitectureConcern;
  level: ComplexityPressureLevel;
  drivers: ComplexityPressureDriver[];
  evidenceRefs: string[];
  confidence: BaselineConfidence;
  provisional: boolean;
  reason: string;
};

export type StructuralSupportAssessment = {
  concern: ArchitectureConcern;
  level: StructuralSupportLevel;
  supports: string[];
  evidenceRefs: string[];
  confidence: BaselineConfidence;
  reason: string;
};

export type StructureAdequacyAssessment = {
  concern: ArchitectureConcern;
  pressure: ComplexityPressureLevel;
  support: StructuralSupportLevel;
  status: StructureAdequacyStatus;
  reason: string;
  nextAction: string;
  evidenceRefs: string[];
  confidence: BaselineConfidence;
};

export type BaselineConcernAssessment = {
  concern: ArchitectureConcern;
  currentState: MaturityState;
  confidence: BaselineConfidence;
  axes: DecisionAxisAssessment;
  thresholdCandidates: ThresholdCandidate[];
  pressure?: ComplexityPressureAssessment;
  support?: StructuralSupportAssessment;
  adequacy?: StructureAdequacyAssessment;
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
  confirmations?: BaselineConfirmation[];
};

export interface ArchitectureBaselineSynthesizer {
  synthesize(input: BaselineInput): ArchitectureBaseline;
}

export interface BaselineInterviewPlanner {
  planQuestions(
    input: BaselineInterviewInput,
    limit?: number,
  ): BaselineQuestion[];
}

export interface BaselineAnswerMerger {
  applyAnswers(input: BaselineAnswerMergeInput): ArchitectureBaseline;
}

export class BaselineValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "BaselineValidationError";
    this.issues = issues;
  }
}
