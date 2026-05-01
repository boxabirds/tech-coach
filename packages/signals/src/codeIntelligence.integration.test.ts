import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codeIntelligenceProvider,
  collectCodeIntelligenceEvidence,
} from "./codeIntelligence.js";
import { runOptionalSignalProviders } from "./providerRunner.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const fixturePath = resolve(here, "__fixtures__/code-intelligence/tsx-report.json");
const scannerBin = resolve(repoRoot, "bin/tech-coach-scan");

describe("code intelligence command integration", () => {
  it("runs a producer command and maps TSX fixture evidence into telemetry", async () => {
    const context = {
      cwd: repoRoot,
      changedFiles: ["src/pages/ProjectEditor.tsx"],
      recentRequests: ["Add saved projects"],
    };
    const evidence = await collectCodeIntelligenceEvidence(context, {
      command: scannerBin,
      args: [fixturePath],
      timeoutMs: 5_000,
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "file_layout",
          confidence: "medium",
          evidence: expect.arrayContaining([
            expect.stringContaining("variants=ts|tsx"),
          ]),
        }),
        expect.objectContaining({
          category: "import_relationship",
          evidence: expect.arrayContaining([
            "import: src/pages/ProjectEditor.tsx -> ../lib/projectStorage",
            "call: src/pages/ProjectEditor.tsx -> saveProject",
          ]),
        }),
        expect.objectContaining({
          category: "diagnostic",
          evidence: expect.arrayContaining([
            "info src/generated/huge.ts: generated file skipped",
            "info src/generated/huge.ts: file skipped by producer",
          ]),
        }),
      ]),
    );

    const result = await runOptionalSignalProviders(
      context,
      [
        codeIntelligenceProvider({
          command: scannerBin,
          args: [fixturePath],
          timeoutMs: 5_000,
        }),
      ],
      { correlationId: "turn-code-intelligence" },
    );

    expect(result.telemetry.repository[0]).toMatchObject({
      source: "code-intelligence:tree-sitter",
      correlationId: "turn-code-intelligence",
    });
    expect(result.telemetry.change).toHaveLength(2);
    expect(result.telemetry.test[0]).toMatchObject({
      source: "code-intelligence:tree-sitter",
      payload: {
        category: "diagnostic",
      },
    });
  });
});
