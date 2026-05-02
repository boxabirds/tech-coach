import { describe, expect, it } from "vitest";
import {
  combineConfidence,
  combineFactConfidence,
  maxAxisScore,
} from "./baselineConfidence.js";
import type { BaselineFact, EvidenceSourceRef } from "./baselineTypes.js";

describe("baseline confidence helpers", () => {
  it("requires corroborated strong evidence for high confidence", () => {
    expect(
      combineConfidence([
        source("configuration_boundary", "high"),
        source("import_relationship", "medium"),
      ]),
    ).toBe("high");
  });

  it("keeps weak or conflicting evidence low confidence", () => {
    expect(combineConfidence([source("symbol_reference", "low")])).toBe("low");
    expect(
      combineConfidence([
        source("configuration_boundary", "high"),
        source("import_relationship", "medium"),
      ], true),
    ).toBe("low");
  });

  it("combines concern facts without overstating single-fact confidence", () => {
    expect(combineFactConfidence([fact("high")])).toBe("medium");
    expect(combineFactConfidence([fact("high"), fact("medium")])).toBe("high");
    expect(combineFactConfidence([fact("low")])).toBe("low");
  });

  it("lets normalized architecture claims carry concern confidence", () => {
    expect(
      combineFactConfidence([fact("high", "architecture_claim")]),
    ).toBe("high");
  });

  it("keeps unknown axis scores below concrete scores", () => {
    expect(maxAxisScore(["unknown", "low"])).toBe("low");
    expect(maxAxisScore(["medium", "high"])).toBe("high");
  });
});

function source(
  category: string,
  confidence: EvidenceSourceRef["confidence"],
): EvidenceSourceRef {
  return {
    source: category,
    category,
    status: "present",
    freshness: "current",
    confidence,
  };
}

function fact(
  confidence: BaselineFact["confidence"],
  category = "configuration_boundary",
): BaselineFact {
  return {
    id: `fact-${confidence}`,
    concern: "data_storage",
    label: "fact",
    status: "observed",
    confidence,
    freshness: "current",
    sources: [source(category, confidence)],
    summary: "fact",
  };
}
