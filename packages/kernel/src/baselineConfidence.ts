import type {
  AxisScore,
  BaselineConfidence,
  BaselineFact,
  BaselineFreshness,
  EvidenceSourceRef,
} from "./baselineTypes.js";

const confidenceRank: Record<BaselineConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const axisRank: Record<AxisScore, number> = {
  low: 1,
  medium: 2,
  high: 3,
  unknown: 0,
};

const strongEvidenceCategories = new Set([
  "changed_file_spread",
  "configuration_boundary",
  "diagnostic",
  "file_layout",
  "import_relationship",
  "monitor_event",
  "runtime_error",
  "test_posture",
]);

export function combineConfidence(
  sources: EvidenceSourceRef[],
  hasConflict = false,
): BaselineConfidence {
  const presentSources = sources.filter((source) => source.status === "present");
  if (presentSources.length === 0 || hasConflict) {
    return "low";
  }

  const strongSources = presentSources.filter((source) =>
    strongEvidenceCategories.has(source.category),
  );
  const highConfidenceSources = presentSources.filter(
    (source) => source.confidence === "high",
  );
  const mediumOrBetter = presentSources.filter(
    (source) => confidenceRank[source.confidence] >= confidenceRank.medium,
  );

  if (
    strongSources.length >= 2
    && highConfidenceSources.length >= 1
    && allCurrentOrUnknown(strongSources)
  ) {
    return "high";
  }

  if (strongSources.length >= 1 || mediumOrBetter.length >= 2) {
    return "medium";
  }

  return "low";
}

export function combineFreshness(sources: EvidenceSourceRef[]): BaselineFreshness {
  if (sources.some((source) => source.freshness === "current")) {
    return "current";
  }
  if (sources.some((source) => source.freshness === "stale")) {
    return "stale";
  }
  return "unknown";
}

export function combineFactConfidence(facts: BaselineFact[]): BaselineConfidence {
  if (facts.length === 0) {
    return "low";
  }
  if (
    facts.some(
      (fact) => fact.confidence === "high" && fact.sources.length >= 2,
    )
  ) {
    return "high";
  }
  const highest = Math.max(...facts.map((fact) => confidenceRank[fact.confidence]));
  if (highest >= confidenceRank.high && facts.length >= 2) {
    return "high";
  }
  if (highest >= confidenceRank.medium) {
    return "medium";
  }
  return "low";
}

export function maxAxisScore(scores: AxisScore[]): AxisScore {
  const max = Math.max(...scores.map((score) => axisRank[score]));
  return (Object.entries(axisRank).find(([, value]) => value === max)?.[0]
    ?? "unknown") as AxisScore;
}

function allCurrentOrUnknown(sources: EvidenceSourceRef[]): boolean {
  return sources.every((source) => source.freshness !== "stale");
}
