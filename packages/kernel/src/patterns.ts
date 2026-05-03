import type {
  ArchitectureConcern,
  BaselineConcernAssessment,
  BaselineConfidence,
  BaselineFact,
} from "./baselineTypes.js";
import type {
  ArchitecturePrinciple,
  ArchitecturePrincipleId,
  BoundaryContractGuidance,
  PatternSelectionInput,
  StructuralPatternId,
  StructuralPatternRecommendation,
} from "./principleTypes.js";

export function selectStructuralPatterns(
  input: PatternSelectionInput,
): StructuralPatternRecommendation[] {
  const { concern, principles, facts } = input;
  if (principles.length === 0) {
    return concern.currentState === "Exploratory" && concern.facts.length === 0
      ? [continueLocally(concern)]
      : [];
  }

  const evidence = evidenceForConcern(facts, concern);
  const text = evidence.map((fact) => fact.summary).join("\n").toLowerCase();
  const patterns: StructuralPatternRecommendation[] = [];

  if (concern.concern === "state_ownership") {
    patterns.push(stateOwnershipPattern(concern, principles, evidence, text));
  }
  if (concern.concern === "data_storage") {
    patterns.push(repositoryBoundaryPattern(concern, principles, evidence, text));
  }
  if (concern.concern === "api_contract") {
    patterns.push(apiContractPattern(concern, principles, evidence, text));
  }
  if (concern.concern === "package_boundary") {
    patterns.push(packageBoundaryTestPattern(concern, principles, evidence, text));
  }
  if (concern.concern === "authentication" || concern.concern === "authorization") {
    patterns.push(securityReviewPattern(concern, principles, evidence));
  }
  if (concern.concern === "deployment" || concern.concern === "observability") {
    patterns.push(operationalReadinessPattern(concern, principles, evidence));
  }
  if (
    concern.concern === "testing"
    || principles.some((principle) => principle.id === "testability")
  ) {
    patterns.push(testHarnessPattern(concern, principles, evidence));
  }

  return dedupePatterns(patterns);
}

export function describeBoundaryContract(input: {
  pattern: StructuralPatternRecommendation;
  concern: BaselineConcernAssessment;
}): BoundaryContractGuidance | undefined {
  const provisional = input.pattern.confidence === "low"
    ? "Treat this as provisional until stronger evidence confirms the boundary."
    : undefined;

  switch (input.pattern.pattern) {
    case "extract_custom_hook":
      return {
        owner: "A custom hook owns state orchestration, effects, and coordination.",
        dependents: "React components depend on hook outputs and callbacks.",
        exclusions: "Rendering stays in components; persistence details stay behind a storage boundary.",
        tests: "Verify the hook behavior around state transitions and side effects.",
        ...(provisional ? { provisional } : {}),
      };
    case "name_state_owner":
      return {
        owner: "A named state owner owns the source of truth for this behavior.",
        dependents: "UI elements depend on the owner instead of duplicating state rules.",
        exclusions: "Do not introduce app-wide state infrastructure until shared cross-route state is real.",
        tests: "Verify ownership rules and state transitions at the named boundary.",
        ...(provisional ? { provisional } : {}),
      };
    case "insert_repository_boundary":
      return {
        owner: "A repository or client boundary owns persistence behavior.",
        dependents: "UI and domain code depend on persistence behavior, not localStorage, files, or database details.",
        exclusions: "Do not choose a server database or backend service until substrate pressure is real.",
        tests: "Verify save, load, failure, and migration-facing behavior through the repository contract.",
        ...(provisional ? { provisional } : {}),
      };
    case "record_api_contract":
      return {
        owner: "The API boundary owns request, response, and failure behavior.",
        dependents: "Callers depend on the documented contract rather than incidental handler details.",
        exclusions: "Do not promise public compatibility while usage is still internal and exploratory.",
        tests: "Verify request, response, compatibility, and failure cases at the API boundary.",
        ...(provisional ? { provisional } : {}),
      };
    case "add_targeted_test_harness":
      return {
        owner: "The introduced or changing boundary owns the behavior under test.",
        dependents: "Future changes depend on the harness to detect contract breakage.",
        exclusions: "Do not add a broad end-to-end suite when a smaller boundary test is sufficient.",
        tests: "Exercise the smallest boundary that proves the load-bearing behavior.",
        ...(provisional ? { provisional } : {}),
      };
    case "run_security_review":
      return {
        owner: "A named security review owns identity, authorization, and failure-mode assumptions.",
        dependents: "Feature work depends on reviewed access and session behavior before relying on it.",
        exclusions: "Do not add a new identity provider or role system until the current access boundary is understood.",
        tests: "Verify authentication, authorization, expiry, denial, and privilege-boundary behavior.",
        ...(provisional ? { provisional } : {}),
      };
    case "operationalize_runtime":
      return {
        owner: "The deployment or runtime boundary owns release, rollback, health, and visibility behavior.",
        dependents: "Users and operators depend on predictable production access and diagnosis.",
        exclusions: "Do not add heavyweight platform machinery until production or shared-use pressure is concrete.",
        tests: "Verify deployment, configuration, health check, logging, and rollback-facing behavior.",
        ...(provisional ? { provisional } : {}),
      };
    case "continue_locally":
      return undefined;
  }
}

function stateOwnershipPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
  text: string,
): StructuralPatternRecommendation {
  const supportsHook = containsAny(text, [
    "usestate",
    "useeffect",
    "effect",
    "url serialization",
    "filter state",
    "imports projectstorage",
    "persistence call",
    "state orchestration",
  ]);

  if (supportsHook) {
    return pattern({
      pattern: "extract_custom_hook",
      concern: concern.concern,
      principles,
      addNow: "Move state orchestration and effects into a custom hook or named state owner before adding more behavior.",
      doNotAddYet: "Do not introduce global state management unless cross-route shared state is real.",
      evidence,
      missingEvidence: [],
      confidence: patternConfidence(concern, evidence),
    });
  }

  return pattern({
    pattern: "name_state_owner",
    concern: concern.concern,
    principles,
    addNow: "Name the state owner and keep duplicated state rules behind that boundary.",
    doNotAddYet: "Do not extract a React hook until evidence shows mixed rendering, effects, or orchestration.",
    evidence,
    missingEvidence: ["mixed rendering/effects/state orchestration evidence"],
    confidence: "low",
  });
}

function repositoryBoundaryPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
  text: string,
): StructuralPatternRecommendation {
  const supportsRepository = containsAny(text, [
    "localstorage",
    "indexeddb",
    "storage",
    "repository",
    "saved project",
    "projectstorage",
    "persistence",
  ]);

  return pattern({
    pattern: "insert_repository_boundary",
    concern: concern.concern,
    principles,
    addNow: "Put persistence behind a repository or client boundary and name the domain object it stores.",
    doNotAddYet: "Do not introduce a server database until sharing, sync, querying, migration, or multi-user pressure exists.",
    evidence,
    missingEvidence: supportsRepository ? [] : ["concrete persistence or storage evidence"],
    confidence: supportsRepository ? patternConfidence(concern, evidence) : "low",
  });
}

function apiContractPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
  text: string,
): StructuralPatternRecommendation {
  const supportsApi = containsAny(text, ["api", "endpoint", "request", "response", "contract", "external", "public"]);
  return pattern({
    pattern: "record_api_contract",
    concern: concern.concern,
    principles,
    addNow: "Record the request, response, and failure behavior that callers can depend on.",
    doNotAddYet: "Do not promise public compatibility while the contract is still internal and exploratory.",
    evidence,
    missingEvidence: supportsApi ? [] : ["caller or request/response dependency evidence"],
    confidence: supportsApi ? patternConfidence(concern, evidence) : "low",
  });
}

function packageBoundaryTestPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
  text: string,
): StructuralPatternRecommendation {
  const hasRuntimeBoundary = containsAny(text, ["runtime boundary", "rust/wasm", "native module"]);
  return pattern({
    pattern: "add_targeted_test_harness",
    concern: concern.concern,
    principles,
    addNow: hasRuntimeBoundary
      ? "Add a small integration test around the React/TypeScript to Rust/WASM boundary before changing behavior across it."
      : "Add a focused boundary test around the package or workspace contract before changing behavior across it.",
    doNotAddYet: "Do not split packages further or introduce a service boundary until the existing runtime/package contract is named and tested.",
    evidence,
    missingEvidence: hasRuntimeBoundary ? [] : ["specific runtime or package contract evidence"],
    confidence: patternConfidence(concern, evidence),
  });
}

function securityReviewPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
): StructuralPatternRecommendation {
  return pattern({
    pattern: "run_security_review",
    concern: concern.concern,
    principles,
    addNow: "Run a focused security review of the identity, authorization, and session boundary before depending on it.",
    doNotAddYet: "Do not introduce a new auth framework or role model until the current boundary and remaining risk are named.",
    evidence,
    missingEvidence: evidence.length > 0 ? [] : ["concrete identity or access-control evidence"],
    confidence: patternConfidence(concern, evidence),
  });
}

function operationalReadinessPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
): StructuralPatternRecommendation {
  return pattern({
    pattern: "operationalize_runtime",
    concern: concern.concern,
    principles,
    addNow: "Add the smallest operational contract for release, health, logs, and rollback-facing behavior.",
    doNotAddYet: "Do not add heavyweight platform, monitoring, or deployment machinery until production/shared-use pressure is concrete.",
    evidence,
    missingEvidence: evidence.length > 0 ? [] : ["deployment or runtime responsibility evidence"],
    confidence: patternConfidence(concern, evidence),
  });
}

function testHarnessPattern(
  concern: BaselineConcernAssessment,
  principles: ArchitecturePrinciple[],
  evidence: BaselineFact[],
): StructuralPatternRecommendation {
  return pattern({
    pattern: "add_targeted_test_harness",
    concern: concern.concern,
    principles,
    addNow: "Add tests around the boundary being introduced or changed.",
    doNotAddYet: "Do not add broad end-to-end coverage when a smaller unit or integration boundary proves the behavior.",
    evidence,
    missingEvidence: evidence.length > 0 ? [] : ["load-bearing boundary evidence"],
    confidence: patternConfidence(concern, evidence),
  });
}

function continueLocally(concern: BaselineConcernAssessment): StructuralPatternRecommendation {
  return {
    pattern: "continue_locally",
    concern: concern.concern,
    principleIds: [],
    addNow: "Continue with local implementation; no durable structure is justified yet.",
    doNotAddYet: "Do not introduce new boundaries, storage, auth, or deployment machinery without a matching threshold signal.",
    evidence: [],
    missingEvidence: ["concrete architecture pressure"],
    confidence: "low",
  };
}

function pattern(input: {
  pattern: StructuralPatternId;
  concern: ArchitectureConcern;
  principles: ArchitecturePrinciple[];
  addNow: string;
  doNotAddYet: string;
  evidence: BaselineFact[];
  missingEvidence: string[];
  confidence: BaselineConfidence;
}): StructuralPatternRecommendation {
  return {
    pattern: input.pattern,
    concern: input.concern,
    principleIds: input.principles.map((principle) => principle.id),
    addNow: input.addNow,
    doNotAddYet: input.doNotAddYet,
    evidence: input.evidence.slice(0, 4).map((fact) => fact.summary),
    missingEvidence: input.missingEvidence,
    confidence: input.confidence,
  };
}

function evidenceForConcern(
  facts: BaselineFact[],
  concern: BaselineConcernAssessment,
): BaselineFact[] {
  const relevant = facts.filter((fact) => fact.concern === concern.concern);
  return relevant.length > 0 ? relevant : concern.facts;
}

function patternConfidence(
  concern: BaselineConcernAssessment,
  evidence: BaselineFact[],
): BaselineConfidence {
  const text = evidence.map((fact) => fact.summary).join("\n").toLowerCase();
  if (
    concern.confidence === "low"
    || evidence.some((fact) => fact.confidence === "low" || fact.freshness !== "current")
    || text.includes("conflict")
    || text.includes("contradict")
  ) {
    return "low";
  }
  if (concern.confidence === "high" && evidence.some((fact) => fact.confidence === "high")) {
    return "high";
  }
  return "medium";
}

function dedupePatterns(
  patterns: StructuralPatternRecommendation[],
): StructuralPatternRecommendation[] {
  const seen = new Set<StructuralPatternId>();
  return patterns.filter((pattern) => {
    if (seen.has(pattern.pattern)) {
      return false;
    }
    seen.add(pattern.pattern);
    return true;
  });
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
