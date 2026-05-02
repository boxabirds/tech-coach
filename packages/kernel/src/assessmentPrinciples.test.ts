import { describe, expect, it } from "vitest";
import { assessArchitecture } from "./assessment.js";
import {
  exploratoryEvent,
  reactStateOwnershipEvent,
  storageBoundaryEvent,
  weakStorageEvent,
} from "./__fixtures__/principles/scenarios.js";

describe("assessment principle guidance", () => {
  it("attaches custom-hook structural guidance for mixed React state ownership", () => {
    const result = assessArchitecture({ event: reactStateOwnershipEvent });
    const guidance = result.principleGuidance.find(
      (item) => item.concern === "state_ownership",
    );

    expect(guidance?.principles.map((principle) => principle.id)).toEqual(
      expect.arrayContaining(["separation_of_concerns", "clear_ownership"]),
    );
    expect(guidance?.patterns[0]).toMatchObject({
      pattern: "extract_custom_hook",
      addNow: expect.stringContaining("custom hook"),
      doNotAddYet: expect.stringContaining("global state"),
    });
    expect(guidance?.contract).toMatchObject({
      owner: expect.stringContaining("custom hook"),
      tests: expect.stringContaining("hook behavior"),
    });
  });

  it("attaches repository-boundary guidance without database escalation", () => {
    const result = assessArchitecture({ event: storageBoundaryEvent });
    const guidance = result.principleGuidance.find(
      (item) => item.concern === "data_storage",
    );

    expect(guidance?.patterns[0]).toMatchObject({
      pattern: "insert_repository_boundary",
      addNow: expect.stringContaining("repository"),
      doNotAddYet: expect.stringContaining("server database"),
    });
    expect(guidance?.contract).toMatchObject({
      owner: expect.stringContaining("repository"),
      exclusions: expect.stringContaining("server database"),
    });
  });

  it("turns React plus Rust/WASM shape into package-boundary guidance", () => {
    const result = assessArchitecture({
      event: {
        ...exploratoryEvent,
        userRequest: "Change behavior across the React/WASM runtime boundary.",
        optionalSignals: [
          {
            source: "repository-shape",
            status: "present",
            category: "architecture_shape",
            freshness: "current",
            confidence: "high",
            evidence: [
              "React/TypeScript frontend shape: src/main.tsx, src/components/Waveform.tsx",
              "Rust crate/native module shape: crates/dsp/Cargo.toml, crates/dsp/src/lib.rs",
              "Runtime boundary: React/TypeScript UI depends on Rust/WASM or native-module code.",
              "Test surface evidence: tests/dsp-boundary.test.ts",
            ],
          },
        ],
      },
    });
    const guidance = result.principleGuidance.find(
      (item) => item.concern === "package_boundary",
    );

    expect(result.action).toBe("Add test harness");
    expect(guidance?.patterns[0]).toMatchObject({
      pattern: "add_targeted_test_harness",
      addNow: expect.stringContaining("React/TypeScript to Rust/WASM boundary"),
      doNotAddYet: expect.stringContaining("service boundary"),
    });
  });

  it("records React plus Rust/WASM shape passively when no change is requested", () => {
    const result = assessArchitecture({
      event: {
        ...exploratoryEvent,
        userRequest: "Assess this existing app",
        optionalSignals: [
          {
            source: "repository-shape",
            status: "present",
            category: "architecture_shape",
            freshness: "current",
            confidence: "high",
            evidence: [
              "React/TypeScript frontend shape: src/main.tsx, src/components/Waveform.tsx",
              "Rust crate/native module shape: crates/dsp/Cargo.toml, crates/dsp/src/lib.rs",
              "Runtime boundary: React/TypeScript UI depends on Rust/WASM or native-module code.",
              "Test surface evidence: tests/dsp-boundary.test.ts",
            ],
          },
        ],
      },
    });

    expect(result.action).toBe("Continue");
    expect(result.intervention).toBe("note");
    expect(result.questions).toEqual([]);
    expect(result.principleGuidance.find(
      (item) => item.concern === "package_boundary",
    )?.patterns[0]).toMatchObject({
      pattern: "add_targeted_test_harness",
    });
  });

  it("keeps exploratory work free of added structure guidance", () => {
    const result = assessArchitecture({ event: exploratoryEvent });

    expect(result.action).toBe("Continue");
    expect(result.principleGuidance).toEqual([]);
    expect(result.doNotAdd).toEqual([
      "Do not add durable architecture structure until there is concrete project evidence.",
    ]);
  });

  it("marks weak evidence as provisional rather than certain", () => {
    const result = assessArchitecture({ event: weakStorageEvent });
    const guidance = result.principleGuidance.find(
      (item) => item.concern === "data_storage",
    );

    expect(guidance?.principles.every((principle) => principle.confidence === "low")).toBe(true);
    expect(guidance?.patterns[0]).toMatchObject({
      confidence: "low",
    });
    expect(guidance?.contract?.provisional).toContain("provisional");
  });
});
