import { describe, expect, it } from "vitest";
import {
  codeIntelligenceReportToEvidence,
  collectCodeIntelligenceEvidence,
  parseCodeIntelligenceReport,
} from "./codeIntelligence.js";
import {
  codeIntelligenceSchemaVersion,
  type CodeIntelligenceReport,
} from "./codeIntelligenceTypes.js";

const report: CodeIntelligenceReport = {
  schemaVersion: codeIntelligenceSchemaVersion,
  producer: { name: "tree-sitter", engine: "rust" },
  repoRoot: "/repo",
  languages: [
    {
      id: "typescript",
      files: 2,
      parsed: 1,
      failed: 1,
      variants: ["ts"],
    },
  ],
  files: [
    {
      path: "src/pages/ProjectEditor.tsx",
      languageId: "typescript",
      parsed: true,
    },
    {
      path: "src/lib/broken.ts",
      languageId: "typescript",
      parsed: false,
      error: "parse failed",
    },
  ],
  symbols: [
    {
      name: "ProjectEditor",
      kind: "function",
      languageId: "typescript",
      location: { file: "src/pages/ProjectEditor.tsx", startLine: 12 },
      complexity: 9,
    },
  ],
  dependencies: [
    {
      source: "src/pages/ProjectEditor.tsx",
      target: "../lib/projectStorage",
      kind: "import",
      languageId: "typescript",
    },
  ],
  complexity: {
    unitCount: 1,
    totalCyclomaticComplexity: 9,
    maxUnitCyclomaticComplexity: 9,
  },
  diagnostics: [
    {
      severity: "warning",
      message: "unsupported language variant: mdx",
      languageId: "mdx",
    },
    {
      severity: "warning",
      message: "generated browser cache complexity spike",
      file: "docs/marketing/ops/data/verify-claims/chrome_profile/WasmTtsEngine/bindings_main.js",
    },
  ],
};

describe("code intelligence adapter", () => {
  it("parses and maps a generic producer report into optional evidence", () => {
    const parsed = parseCodeIntelligenceReport(JSON.stringify(report));
    const evidence = codeIntelligenceReportToEvidence(parsed, {
      changedFiles: ["src/pages/ProjectEditor.tsx"],
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "code-intelligence:tree-sitter",
          category: "file_layout",
          confidence: "medium",
          evidence: expect.arrayContaining([
            expect.stringContaining("parse coverage: 1/2"),
            expect.stringContaining("variants=ts"),
          ]),
        }),
        expect.objectContaining({
          category: "import_relationship",
          evidence: ["import: src/pages/ProjectEditor.tsx -> ../lib/projectStorage"],
        }),
        expect.objectContaining({
          category: "symbol_reference",
          evidence: ["function: ProjectEditor @ src/pages/ProjectEditor.tsx:12"],
        }),
        expect.objectContaining({
          category: "diagnostic",
          evidence: expect.arrayContaining([
            "warning unsupported language variant: mdx",
            "warning src/lib/broken.ts: parse failed",
            "warning TSX files were reported but no TSX parser variant was declared",
          ]),
        }),
      ]),
    );
    const diagnostics = evidence.find((item) => item.category === "diagnostic");
    expect(diagnostics?.evidence).not.toEqual(
      expect.arrayContaining([expect.stringContaining("chrome_profile")]),
    );
  });

  it("rejects malformed JSON and schema mismatches", () => {
    expect(() => parseCodeIntelligenceReport("{")).toThrow(/malformed/);
    expect(() =>
      parseCodeIntelligenceReport(JSON.stringify({ ...report, schemaVersion: "old" }))
    ).toThrow(/unsupported code intelligence schemaVersion old/);
    expect(() =>
      parseCodeIntelligenceReport(JSON.stringify({ ...report, files: "nope" }))
    ).toThrow(/files must be an array/);
  });

  it("requires a producer command and reports failed command boundaries as diagnostic evidence", async () => {
    await expect(
      collectCodeIntelligenceEvidence({
        cwd: "/repo",
        changedFiles: [],
        recentRequests: [],
      }),
    ).rejects.toThrow("code intelligence producer command is required");

    await expect(
      collectCodeIntelligenceEvidence(
        { cwd: "/repo", changedFiles: [], recentRequests: [] },
        {
          command: "scanner",
          runCommand: async () => ({ stdout: "", stderr: "boom", exitCode: 2 }),
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        error: "producer exited with code 2",
        evidence: ["boom"],
      }),
    ]);

    await expect(
      collectCodeIntelligenceEvidence(
        { cwd: "/repo", changedFiles: [], recentRequests: [] },
        {
          command: "scanner",
          runCommand: async () => ({ stdout: "{", stderr: "", exitCode: 0 }),
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("malformed code intelligence JSON"),
      }),
    ]);

    await expect(
      collectCodeIntelligenceEvidence(
        { cwd: "/repo", changedFiles: [], recentRequests: [] },
        {
          command: "scanner",
          runCommand: async () => {
            throw new Error("producer timed out after 10ms");
          },
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        error: "producer timed out after 10ms",
      }),
    ]);
  });
});
