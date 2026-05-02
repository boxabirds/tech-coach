import type {
  ArchitectureConcern,
  BaselineConcernAssessment,
  BaselineConfidence,
  BaselineFact,
} from "./baselineTypes.js";

export type ArchitecturePrincipleId =
  | "separation_of_concerns"
  | "right_sized_abstraction"
  | "clear_ownership"
  | "stable_contract"
  | "reversible_decision"
  | "testability"
  | "operational_readiness";

export type ArchitecturePrinciple = {
  id: ArchitecturePrincipleId;
  concern: ArchitectureConcern;
  name: string;
  rationale: string;
  confidence: BaselineConfidence;
  evidence: string[];
};

export type StructuralPatternId =
  | "extract_custom_hook"
  | "name_state_owner"
  | "insert_repository_boundary"
  | "record_api_contract"
  | "add_targeted_test_harness"
  | "run_security_review"
  | "operationalize_runtime"
  | "continue_locally";

export type StructuralPatternRecommendation = {
  pattern: StructuralPatternId;
  concern: ArchitectureConcern;
  principleIds: ArchitecturePrincipleId[];
  addNow: string;
  doNotAddYet: string;
  evidence: string[];
  missingEvidence: string[];
  confidence: BaselineConfidence;
};

export type BoundaryContractGuidance = {
  owner: string;
  dependents: string;
  exclusions: string;
  tests: string;
  provisional?: string;
};

export type PrincipleGuidance = {
  concern: ArchitectureConcern;
  principles: ArchitecturePrinciple[];
  patterns: StructuralPatternRecommendation[];
  contract?: BoundaryContractGuidance;
};

export type PrincipleSelectionInput = {
  concern: BaselineConcernAssessment;
  facts: BaselineFact[];
};

export type PatternSelectionInput = {
  concern: BaselineConcernAssessment;
  principles: ArchitecturePrinciple[];
  facts: BaselineFact[];
};
