import type {
  CoachEventEnvelope,
  DecisionRecordSummary,
  OptionalSignalSummary,
  ProtocolValidationIssue,
  TestSummary,
} from "./protocol.js";
import type {
  ComplexityPressureLevel,
  StructuralSupportLevel,
  StructureAdequacyStatus,
} from "./baselineTypes.js";
import type { OptionalSignalResult } from "../../signals/src/index.js";

export type SignalFamily =
  | "lifecycle"
  | "repository"
  | "change"
  | "test"
  | "memory"
  | "runtime";

export type SignalScope = "session" | "repo" | "change" | "concern" | "runtime";
export type TelemetryFreshness = "current" | "stale" | "unknown";
export type TelemetryConfidence = "low" | "medium" | "high";
export type TelemetrySignalStatus = "present" | "absent" | "failed";

export type SignalEnvelope<TPayload> = {
  id: string;
  family: SignalFamily;
  source: string;
  capturedAt: string;
  freshness: TelemetryFreshness;
  confidence: TelemetryConfidence;
  scope: SignalScope;
  status: TelemetrySignalStatus;
  correlationId?: string;
  relatedEventId?: string;
  payload: TPayload;
};

export type LifecycleSignal = {
  host: string;
  event: string;
  cwd: string;
  userRequest?: string;
  recentRequests: string[];
  canInjectContext?: boolean;
  canBlock?: boolean;
};

export type RepositorySignal = {
  category: string;
  repoRoot: string;
  evidence: string[];
  details?: Record<string, unknown>;
};

export type ChangeSignal = {
  category: string;
  changedFiles: string[];
  evidence: string[];
  diffSummary?: string;
};

export type TestSignal = {
  status?: TestSummary["status"];
  category: string;
  evidence: string[];
  summary?: string;
};

export type MemorySignal = {
  id?: string;
  kind?: string;
  adviceStatus?: string;
  concern?: string;
  decision?: string;
  context?: string;
  reason?: string;
  risks?: string[];
  state?: string;
  source?: string;
  createdAt?: string;
  revisitIf: string[];
  pressure?: ComplexityPressureLevel;
  support?: StructuralSupportLevel;
  adequacyStatus?: StructureAdequacyStatus;
  acceptedRisk?: string;
  evidenceRefs?: string[];
  evidence: string[];
};

export type RuntimeSignal = {
  category: string;
  evidence: string[];
  details?: Record<string, unknown>;
};

export type TelemetryDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  family?: SignalFamily;
  source?: string;
  message: string;
};

export type ArchitecturalTelemetryBundle = {
  lifecycle: SignalEnvelope<LifecycleSignal>[];
  repository: SignalEnvelope<RepositorySignal>[];
  change: SignalEnvelope<ChangeSignal>[];
  test: SignalEnvelope<TestSignal>[];
  memory: SignalEnvelope<MemorySignal>[];
  runtime: SignalEnvelope<RuntimeSignal>[];
  diagnostics: TelemetryDiagnostic[];
};

export type TelemetryValidationResult = {
  valid: boolean;
  issues: ProtocolValidationIssue[];
};

export type TelemetryCompatibilityInput = {
  event?: CoachEventEnvelope;
  evidence?: Array<OptionalSignalResult | OptionalSignalSummary>;
  testSummary?: TestSummary;
  priorDecisions?: DecisionRecordSummary[];
  capturedAt?: string;
  correlationId?: string;
};

export class TelemetryValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "TelemetryValidationError";
    this.issues = issues;
  }
}

export interface ArchitecturalTelemetryNormalizer {
  fromEvent(event: CoachEventEnvelope): ArchitecturalTelemetryBundle;
  fromEvidence(input: TelemetryCompatibilityInput): ArchitecturalTelemetryBundle;
  validate(bundle: ArchitecturalTelemetryBundle): TelemetryValidationResult;
}
