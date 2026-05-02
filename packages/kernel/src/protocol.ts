export type SignalStatus = "present" | "absent" | "failed";

export type MaturityState =
  | "Exploratory"
  | "Emerging"
  | "Named"
  | "Owned"
  | "LoadBearing"
  | "Hardened"
  | "Operational"
  | "Revisit";

export type InterventionLevel =
  | "silent"
  | "note"
  | "recommend"
  | "interview-required"
  | "decision-required"
  | "block";

export type ArchitectureInteractionContext =
  | "passive_baseline"
  | "requested_next_action"
  | "pending_change_assessment"
  | "risk_review"
  | "deployment_planning"
  | "architecture_decision";

export type CoachAction =
  | "Continue"
  | "Localize"
  | "Name"
  | "Extract"
  | "Assign ownership"
  | "Insert boundary"
  | "Record decision"
  | "Add test harness"
  | "Run review"
  | "Split module"
  | "Replace substrate"
  | "Operationalize"
  | "Stop and decide";

export type RepoSignalSummary = {
  status: SignalStatus;
  evidence?: string[];
  [key: string]: unknown;
};

export type TestSummary = {
  status?: "passed" | "failed" | "not_run" | "unknown";
  summary?: string;
  [key: string]: unknown;
};

export type DecisionRecordSummary = {
  id?: string;
  concern?: string;
  decision?: string;
  revisitIf?: string[];
  [key: string]: unknown;
};

export type OptionalSignalSummary = {
  source?: string;
  status?: SignalStatus;
  category?: string;
  evidence?: string[];
  [key: string]: unknown;
};

export type CoachEventEnvelope = {
  host: string;
  event: string;
  cwd: string;
  interactionContext?: ArchitectureInteractionContext;
  userRequest?: string;
  recentRequests: string[];
  changedFiles: string[];
  repoSignals: RepoSignalSummary;
  testSummary?: TestSummary;
  memoryRefs: string[];
  priorDecisions: DecisionRecordSummary[];
  optionalSignals: OptionalSignalSummary[];
};

export type AssessmentView = {
  concern?: string;
  fromState?: MaturityState;
  toState?: MaturityState;
  intervention?: InterventionLevel;
  action?: CoachAction;
};

export type HostLifecycleEvent = Record<string, unknown>;

export type ProtocolValidationIssue = {
  field: string;
  message: string;
};

export class ProtocolValidationError extends Error {
  readonly issues: ProtocolValidationIssue[];

  constructor(issues: ProtocolValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "ProtocolValidationError";
    this.issues = issues;
  }
}

export interface ProtocolSignalNormalizer {
  normalize(raw: HostLifecycleEvent): CoachEventEnvelope;
}
