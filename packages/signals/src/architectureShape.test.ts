import { describe, expect, it } from "vitest";
import { architectureShapeProvider } from "./architectureShape.js";
import type { OptionalSignalResult, SignalContext } from "./index.js";

const baseContext: SignalContext = {
  cwd: "/repo",
  changedFiles: [],
  recentRequests: [],
};

describe("architectureShapeProvider", () => {
  it("detects a React plus Rust/WASM repository shape with boundary evidence", () => {
    const result = architectureShapeProvider.collect({
      ...baseContext,
      knownFiles: [
        "package.json",
        "src/main.tsx",
        "src/components/Waveform.tsx",
        "crates/dsp/Cargo.toml",
        "crates/dsp/src/lib.rs",
        "tests/dsp-boundary.test.ts",
        "pkg/generated_bg.wasm",
        ".ceetrix/tech-lead/latest-assessment.md",
        "target/debug/libdsp.rlib",
      ],
    }) as OptionalSignalResult;

    expect(result).toMatchObject({
      source: "repository-shape",
      status: "present",
      category: "architecture_shape",
    });
    expect(result?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("React/TypeScript frontend shape"),
        expect.stringContaining("Rust crate/native module shape"),
        expect.stringContaining("Runtime boundary"),
        expect.stringContaining("Test surface evidence"),
      ]),
    );
    expect(result?.evidence.join("\n")).not.toContain(".ceetrix/tech-lead");
    expect(result?.evidence.join("\n")).not.toContain("target/debug");
    expect(result?.evidence.join("\n")).not.toContain("generated_bg.wasm");
  });

  it("reports absent evidence for an unclear repository", () => {
    const result = architectureShapeProvider.collect({
      ...baseContext,
      knownFiles: ["README.md", "docs/notes.md"],
    }) as OptionalSignalResult;

    expect(result).toMatchObject({
      status: "absent",
      confidence: "low",
      error: expect.stringContaining("no recognizable"),
    });
  });

  it("detects Swift macOS package shape without build artifacts", () => {
    const result = architectureShapeProvider.collect({
      ...baseContext,
      knownFiles: [
        "ScreencapMenuBar/Package.swift",
        "ScreencapMenuBar/Sources/EditorAppDelegate.swift",
        "ScreencapMenuBar/Sources/RecordingDocument.swift",
        "ScreencapMenuBar/Cutaway.entitlements",
        "ScreencapMenuBar/.build/debug.yaml",
      ],
    }) as OptionalSignalResult;

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Swift/macOS app shape"),
        expect.stringContaining("Package boundary evidence"),
      ]),
    );
    expect(result.evidence.join("\n")).not.toContain(".build");
  });
});
