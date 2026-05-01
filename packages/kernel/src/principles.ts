import type {
  BaselineConcernAssessment,
  BaselineConfidence,
  BaselineFact,
} from "./baselineTypes.js";
import type {
  ArchitecturePrinciple,
  ArchitecturePrincipleId,
  PrincipleSelectionInput,
} from "./principleTypes.js";

const principleNames: Record<ArchitecturePrincipleId, string> = {
  separation_of_concerns: "Separation of concerns",
  right_sized_abstraction: "Right-sized abstraction",
  clear_ownership: "Clear ownership",
  stable_contract: "Stable contract",
  reversible_decision: "Reversible decision",
  testability: "Testability",
  operational_readiness: "Operational readiness",
};

export function selectArchitecturePrinciples(
  input: PrincipleSelectionInput,
): ArchitecturePrinciple[] {
  const concern = input.concern;
  if (concern.facts.length === 0) {
    return [];
  }

  const evidence = evidenceForConcern(input.facts, concern);
  const confidence = confidenceForPrinciples(concern, evidence);
  const principles = new Set<ArchitecturePrincipleId>();

  switch (concern.concern) {
    case "state_ownership":
      principles.add("separation_of_concerns");
      principles.add("clear_ownership");
      principles.add("right_sized_abstraction");
      break;
    case "data_storage":
      principles.add("stable_contract");
      principles.add("right_sized_abstraction");
      principles.add("reversible_decision");
      break;
    case "api_contract":
      principles.add("stable_contract");
      principles.add("testability");
      principles.add("reversible_decision");
      break;
    case "package_boundary":
      principles.add("separation_of_concerns");
      principles.add("clear_ownership");
      principles.add("stable_contract");
      break;
    case "testing":
      principles.add("testability");
      break;
    case "deployment":
    case "observability":
      principles.add("operational_readiness");
      principles.add("testability");
      break;
    case "authentication":
    case "authorization":
      principles.add("stable_contract");
      principles.add("clear_ownership");
      principles.add("testability");
      break;
    case "risk_hotspot":
      principles.add("separation_of_concerns");
      principles.add("clear_ownership");
      principles.add("right_sized_abstraction");
      break;
    default:
      if (concern.confidence === "high") {
        principles.add("reversible_decision");
      }
      break;
  }

  if (
    concern.currentState === "Owned"
    || concern.currentState === "LoadBearing"
    || concern.currentState === "Revisit"
    || concern.thresholdCandidates.includes("persistence")
    || concern.thresholdCandidates.includes("public_api")
    || concern.thresholdCandidates.includes("security")
  ) {
    principles.add("testability");
  }

  return Array.from(principles).map((id) => ({
    id,
    concern: concern.concern,
    name: principleNames[id],
    rationale: rationaleFor(id, concern),
    confidence,
    evidence: evidence.slice(0, 4).map((fact) => fact.summary),
  }));
}

function evidenceForConcern(
  facts: BaselineFact[],
  concern: BaselineConcernAssessment,
): BaselineFact[] {
  const relevant = facts.filter((fact) => fact.concern === concern.concern);
  return relevant.length > 0 ? relevant : concern.facts;
}

function confidenceForPrinciples(
  concern: BaselineConcernAssessment,
  facts: BaselineFact[],
): BaselineConfidence {
  const text = facts.map((fact) => fact.summary).join("\n").toLowerCase();
  if (
    concern.confidence === "low"
    || facts.some((fact) => fact.confidence === "low" || fact.freshness !== "current")
    || text.includes("conflict")
    || text.includes("contradict")
  ) {
    return "low";
  }
  if (concern.confidence === "high" && facts.some((fact) => fact.confidence === "high")) {
    return "high";
  }
  return "medium";
}

function rationaleFor(
  id: ArchitecturePrincipleId,
  concern: BaselineConcernAssessment,
): string {
  const thresholds = concern.thresholdCandidates.join(", ") || "no named threshold";
  switch (id) {
    case "separation_of_concerns":
      return `${concern.concern} evidence shows mixed reasons to change across ${thresholds}.`;
    case "right_sized_abstraction":
      return `${concern.concern} needs the smallest useful boundary for its current maturity.`;
    case "clear_ownership":
      return `${concern.concern} needs an explicit owner or source of truth.`;
    case "stable_contract":
      return `${concern.concern} behavior is becoming depended on and needs a named contract.`;
    case "reversible_decision":
      return `${concern.concern} should preserve options while the final substrate remains uncertain.`;
    case "testability":
      return `${concern.concern} is mature enough that behavior should be protected at its boundary.`;
    case "operational_readiness":
      return `${concern.concern} evidence points toward runtime or production responsibility.`;
  }
}
