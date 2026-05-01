import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRuntimeArtifactExists,
  parseCliArgs,
  renderAssessmentOutput,
  runAssessmentCommand,
  runCli,
  type CliRuntime,
} from "./index.js";
import { localStorageDecision } from "../../kernel/src/__fixtures__/memory/scenarios.js";
import {
  cliEventInput,
  cliRevisitInput,
  cliTelemetryInput,
  invalidCliInput,
} from "./__fixtures__/inputs.js";

describe("CLI argument contract", () => {
  it("parses assess options with read-only behavior by default", () => {
    expect(parseCliArgs([
      "assess",
      "--input",
      "input.json",
      "--output",
      "json",
      "--memory",
      ".archcoach/memory.jsonl",
    ])).toEqual({
      command: "assess",
      inputPath: "input.json",
      output: "json",
      memoryPath: ".archcoach/memory.jsonl",
      readOnly: true,
    });
  });

  it("rejects invalid output formats and memory-writing assess mode", () => {
    expect(() => parseCliArgs(["assess", "--output", "yaml"])).toThrow(/Unsupported output/);
    expect(() => parseCliArgs(["assess", "--write-memory"])).toThrow(/Memory writes/);
  });

  it("parses durable capture, answer, and decision commands", () => {
    expect(parseCliArgs(["capture", "--repo", "/repo", "--output", "json"])).toMatchObject({
      command: "capture",
      repo: "/repo",
      output: "json",
    });
    expect(parseCliArgs([
      "answer",
      "--repo",
      "/repo",
      "--question",
      "q1",
      "--answer",
      "yes",
      "--action",
      "correct",
    ])).toMatchObject({
      command: "answer",
      repo: "/repo",
      questionId: "q1",
      answer: "yes",
      action: "correct",
    });
    expect(parseCliArgs(["decide", "--repo", "/repo", "--confirm"])).toMatchObject({
      command: "decide",
      confirm: true,
    });
  });

  it("reports a missing bundled runtime artifact", () => {
    expect(() =>
      assertRuntimeArtifactExists("dist/missing-cli.js", {
        cwd: "/repo",
        fileExists: () => false,
      }),
    ).toThrow(/Missing bundled runtime artifact/);
  });
});

describe("runAssessmentCommand", () => {
  it("returns structured JSON-ready output for legacy event input", () => {
    const output = runAssessmentCommand(
      cliEventInput,
      { output: "json", readOnly: true },
      testRuntime(),
    );

    expect(output.result).toMatchObject({
      status: "needs_attention",
      action: "Record decision",
      memory: { status: "absent", decisionCount: 0 },
    });
    expect(renderAssessmentOutput(output, "json")).toContain("\"family\": \"repository\"");
  });

  it("accepts telemetry input and renders family/source evidence in text", () => {
    const output = runAssessmentCommand(
      cliTelemetryInput,
      { output: "text", readOnly: true },
      testRuntime(),
    );
    const text = renderAssessmentOutput(output, "text");

    expect(text).toContain("Action: Record decision");
    expect(text).toContain("repository/layout:file_layout");
    expect(text).toContain("Evidence:");
  });

  it("loads project memory read-only and returns revisit guidance", () => {
    const root = tempRoot();
    const memoryPath = join(root, "memory.jsonl");
    writeFileSync(memoryPath, `${JSON.stringify(localStorageDecision)}\n`, "utf8");

    try {
      const output = runAssessmentCommand(
        cliRevisitInput,
        { output: "json", readOnly: true, memoryPath },
        testRuntime(root),
      );

      expect(output.result).toMatchObject({
        action: "Replace substrate",
        memory: { status: "loaded", decisionCount: 1 },
      });
      expect(output.result.revisitAlerts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decisionId: "decision-localstorage-projects",
          }),
        ]),
      );
      expect(readdirSync(root).sort()).toEqual(["memory.jsonl"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps no-memory state explicit without inventing project history", () => {
    const output = runAssessmentCommand(
      cliEventInput,
      { output: "text", readOnly: true },
      testRuntime(),
    );

    expect(output.memoryDiagnostics).toContainEqual(
      expect.objectContaining({
        id: "memory-not-configured",
        severity: "info",
      }),
    );
    expect(output.result.memory).toEqual({ status: "absent", decisionCount: 0 });
  });
});

describe("runCli", () => {
  it("reads JSON from stdin and writes JSON output", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runCli(testRuntime("/repo", {
      argv: ["assess", "--output", "json"],
      stdin: JSON.stringify(cliEventInput),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    }));

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("\"action\": \"Record decision\"");
  });

  it("returns actionable validation errors for invalid input", async () => {
    const stderr: string[] = [];
    const result = await runCli(testRuntime("/repo", {
      argv: ["assess"],
      stdin: JSON.stringify(invalidCliInput),
      stderr: (text) => stderr.push(text),
    }));

    expect(result.exitCode).toBe(1);
    expect(stderr.join("")).toContain("cwd: is required");
  });
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "archcoach-cli-"));
}

function testRuntime(
  cwd = "/repo",
  overrides: Partial<{
    argv: string[];
    stdin: string;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }> = {},
): CliRuntime {
  return {
    argv: overrides.argv ?? [],
    cwd,
    readStdin: () => overrides.stdin ?? "",
    readFile: (path) => {
      throw new Error(`unexpected readFile: ${path}`);
    },
    fileExists: () => true,
    stdout: overrides.stdout ?? (() => undefined),
    stderr: overrides.stderr ?? (() => undefined),
  };
}
