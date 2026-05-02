import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSelectedCommand } from "../../cli/src/index.js";
import { handleMcpJsonRpc } from "../../../mcp/server/index.js";
import { thresholdEvent, decisionToRecord } from "../../mcp/src/__fixtures__/inputs.js";
import { localStorageDecision } from "../../kernel/src/__fixtures__/memory/scenarios.js";
import type { ToolResult } from "../../mcp/src/tools.js";
import type { CaptureAssessmentResult } from "../../persistence/src/index.js";
import type {
  AssessmentIndexResult,
  GraphPage,
  NodeDetail,
} from "../../persistence/src/assessmentGraph.js";
import {
  assertDurableAssessmentPack,
  readArtifactJson,
} from "./persistenceAssertions.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("persistence E2E workflows", () => {
  maybeIt("captures through the CLI and creates human plus machine artifacts", () => {
    const repo = tempRepo();
    try {
      const text = runSelectedCommand(
        { event: { ...thresholdEvent, cwd: repo } },
        { command: "capture", output: "text", readOnly: false, repo },
        runtime(repo),
      );

      expect(text).toContain("Durable record: created");
      expect(text).toContain("Generated reports from the local SQLite store");
      expect(text).toContain("latest assessment report");
      expect(existsSync(join(repo, ".ceetrix", "tech-lead", "tech-lead.db"))).toBe(true);
      expect(existsSync(join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"))).toBe(true);
      expect(existsSync(join(repo, ".ceetrix", "tech-lead", "questions.json"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("captures, answers, confirms a decision, and reruns through MCP public tools", async () => {
    const repo = tempRepo();
    try {
      const capture = await callMcp<CaptureAssessmentResult>("architecture.capture_assessment", {
        cwd: repo,
        event: { ...thresholdEvent, cwd: repo },
        now: "2026-05-01T11:00:00.000Z",
        responseDetail: "full",
      });
      assertDurableAssessmentPack(capture);
      expect(capture.openQuestions.length).toBeGreaterThan(0);

      const question = capture.openQuestions[0];
      const answered = await callMcp<CaptureAssessmentResult>("architecture.answer_question", {
        cwd: repo,
        questionId: question.id,
        action: "confirm",
        value: "The system needs durable local state before team sharing.",
        now: "2026-05-01T11:01:00.000Z",
        responseDetail: "full",
      });
      expect(answered.answeredQuestions).toContainEqual(
        expect.objectContaining({ questionId: question.id }),
      );

      const decided = await callMcp<CaptureAssessmentResult>("architecture.record_decision", {
        cwd: repo,
        confirmed: true,
        decision: {
          ...decisionToRecord,
          id: "decision-e2e-mcp",
          createdAt: "2026-05-01T11:02:00.000Z",
        },
        now: "2026-05-01T11:02:00.000Z",
        responseDetail: "full",
      });
      expect(decided.decisions).toContainEqual(expect.objectContaining({ id: "decision-e2e-mcp" }));

      const rerun = await callMcp<CaptureAssessmentResult>("architecture.capture_assessment", {
        cwd: repo,
        event: { ...thresholdEvent, cwd: repo, userRequest: "Reassess with persisted context" },
        now: "2026-05-01T11:03:00.000Z",
        responseDetail: "full",
      });
      assertDurableAssessmentPack(rerun);
      expect(rerun.lifecycleState).toBe("rerun_reused");
      expect(rerun.answeredQuestions).toContainEqual(expect.objectContaining({ questionId: question.id }));
      expect(rerun.decisions).toContainEqual(expect.objectContaining({ id: "decision-e2e-mcp" }));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("persists accepted architecture debt with adequacy fields and reopens it on pressure change", async () => {
    const repo = tempRepo();
    try {
      await callMcp<CaptureAssessmentResult>("architecture.capture_assessment", {
        cwd: repo,
        event: {
          host: "persistence-e2e",
          event: "assessment",
          cwd: repo,
          userRequest: "Capture current local project storage",
          recentRequests: [],
          changedFiles: ["src/lib/projectStorage.ts"],
          repoSignals: {
            status: "present",
            evidence: ["Saved projects write to localStorage for a single-user workflow."],
          },
          memoryRefs: [],
          priorDecisions: [],
          optionalSignals: [],
        },
        now: "2026-05-01T11:10:00.000Z",
        responseDetail: "full",
      });

      await callMcp<CaptureAssessmentResult>("architecture.record_decision", {
        cwd: repo,
        confirmed: true,
        decision: {
          ...localStorageDecision,
          id: "accepted-debt-localstorage-e2e",
          adviceStatus: "handled",
          createdAt: "2026-05-01T11:11:00.000Z",
        },
        now: "2026-05-01T11:11:00.000Z",
        responseDetail: "full",
      });

      const rerun = await callMcp<CaptureAssessmentResult>("architecture.capture_assessment", {
        cwd: repo,
        event: {
          host: "persistence-e2e",
          event: "assessment",
          cwd: repo,
          userRequest: "Let teams share saved projects across devices",
          recentRequests: ["Sync saved projects"],
          changedFiles: ["src/lib/projectStorage.ts", "src/api/projects.ts"],
          repoSignals: {
            status: "present",
            evidence: [
              "Saved projects write to localStorage and now need team sharing, sync, and collaboration.",
            ],
          },
          memoryRefs: ["accepted-debt-localstorage-e2e"],
          priorDecisions: [],
          optionalSignals: [],
        },
        now: "2026-05-01T11:12:00.000Z",
        responseDetail: "full",
      });

      expect(rerun.decisions).toContainEqual(
        expect.objectContaining({
          id: "accepted-debt-localstorage-e2e",
          kind: "accepted_debt",
          adviceStatus: "handled",
          pressure: "medium",
          support: "localized",
          adequacyStatus: "under_structured",
          acceptedRisk: expect.stringContaining("Data cannot be shared"),
        }),
      );
      expect(rerun.assessment.revisitAlerts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decisionId: "accepted-debt-localstorage-e2e",
            matchedCondition: expect.stringContaining("reopened"),
          }),
        ]),
      );
      expect(rerun.assessment.architectureDebt).toContainEqual(
        expect.objectContaining({
          concern: "data_storage",
          status: "reopened",
        }),
      );
      const decisionsJsonl = readFileSync(rerun.artifactPaths!.decisionsJsonl, "utf8");
      expect(decisionsJsonl).toContain("\"kind\":\"accepted_debt\"");
      expect(decisionsJsonl).toContain("\"adviceStatus\":\"handled\"");
      expect(decisionsJsonl).toContain("\"pressure\":\"medium\"");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("cwd-only MCP capture collects concrete architecture shape before persisting", async () => {
    const repo = tempRepo();
    try {
      writeFileSync(join(repo, "package.json"), JSON.stringify({
        scripts: { test: "echo ok" },
        dependencies: { "@vitejs/plugin-react": "latest" },
      }), "utf8");
      mkdirSync(join(repo, "src", "components"), { recursive: true });
      mkdirSync(join(repo, "crates", "dsp", "src"), { recursive: true });
      mkdirSync(join(repo, "tests"), { recursive: true });
      mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
      writeFileSync(join(repo, "src", "main.tsx"), "import { createRoot } from 'react-dom/client';\n", "utf8");
      writeFileSync(join(repo, "src", "components", "Waveform.tsx"), "export function Waveform() { return null; }\n", "utf8");
      writeFileSync(join(repo, "crates", "dsp", "Cargo.toml"), "[package]\nname = \"dsp\"\n", "utf8");
      writeFileSync(join(repo, "crates", "dsp", "src", "lib.rs"), "pub fn process() {}\n", "utf8");
      writeFileSync(join(repo, "tests", "dsp-boundary.test.ts"), "test('boundary', () => {});\n", "utf8");
      writeFileSync(join(repo, ".ceetrix", "tech-lead", "old-assessment.md"), "ignore me\n", "utf8");

      const capture = await callMcp<CaptureAssessmentResult>("architecture.capture_assessment", {
        cwd: repo,
        now: "2026-05-01T11:00:30.000Z",
        responseDetail: "full",
      });

      assertDurableAssessmentPack(capture);
      expect(capture.assessment.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ family: "repository", source: "file-tree" }),
          expect.objectContaining({ family: "repository", source: "repository-shape" }),
          expect.objectContaining({ family: "repository", source: "config-boundary" }),
        ]),
      );
      expect(JSON.stringify(capture.assessment.evidence)).toContain("React/TypeScript frontend shape");
      expect(JSON.stringify(capture.assessment.evidence)).toContain("Runtime boundary");
      expect(capture.assessment.action).toBe("Add test harness");
      expect(capture.assessment.principleGuidance).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            concern: "package_boundary",
            patterns: expect.arrayContaining([
              expect.objectContaining({
                addNow: expect.stringContaining("React/TypeScript to Rust/WASM boundary"),
              }),
            ]),
          }),
        ]),
      );
      const latestMarkdown = readFileSync(capture.artifactPaths!.latestAssessmentMd, "utf8");
      expect(latestMarkdown).toContain("Observed Architecture Shape");
      expect(latestMarkdown).toContain("React/TypeScript");
      expect(latestMarkdown).toContain("Rust/WASM boundary");
      expect(JSON.stringify(capture.assessment.evidence)).not.toContain(".ceetrix/tech-lead");
      expect(capture.assessment.reason).not.toContain("No concrete architecture evidence");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("MCP capture returns a bounded graph index and supports incremental graph navigation", async () => {
    const repo = tempRepo();
    try {
      mkdirSync(join(repo, "apps", "web", "src", "auth"), { recursive: true });
      mkdirSync(join(repo, "apps", "web", "src"), { recursive: true });
      mkdirSync(join(repo, "workers", "api"), { recursive: true });
      mkdirSync(join(repo, "migrations"), { recursive: true });
      for (let index = 0; index < 250; index += 1) {
        writeFileSync(join(repo, `apps/web/src/noise-${index}.ts`), `export const n${index} = ${index};\n`, "utf8");
      }
      writeFileSync(join(repo, "apps", "web", "src", "auth", "github-auth.ts"), "export const oauth = 'github';\n", "utf8");
      writeFileSync(join(repo, "apps", "web", "src", "session.ts"), "export const session = true;\n", "utf8");
      writeFileSync(join(repo, "workers", "api", "wrangler.toml"), "name = 'api'\n", "utf8");
      writeFileSync(join(repo, "migrations", "0001_schema.sql"), "create table sessions(id text);\n", "utf8");

      const response = await rawMcp("architecture.capture_assessment", {
        cwd: repo,
        now: "2026-05-01T11:04:00.000Z",
      });
      const text = (response?.result as { content?: Array<{ text?: string }> } | undefined)
        ?.content?.[0]?.text ?? "";
      expect(text.length).toBeLessThan(25_000);

      const parsed = JSON.parse(text) as ToolResult<AssessmentIndexResult>;
      expect(parsed.ok).toBe(true);
      const index = parsed.ok ? parsed.result : undefined;
      expect(index).toMatchObject({
        durableRecordCreated: true,
        orientation: {
          state: "first_use",
          shouldShowPreamble: true,
          preamble: expect.objectContaining({
            problem: expect.stringContaining("premature structure"),
            storageModel: expect.stringContaining("durable local source of truth"),
          }),
        },
        recommendation: expect.objectContaining({ action: expect.any(String) }),
        initialPage: expect.objectContaining({
          pageInfo: expect.objectContaining({ limit: expect.any(Number) }),
        }),
      });
      expect(JSON.stringify(index)).not.toContain("\"baseline\"");
      expect(JSON.stringify(index)).not.toContain("\"telemetry\"");
      expect(index!.navigationHints.length).toBeGreaterThan(0);

      const claims = await callMcp<GraphPage>("architecture.query_assessment_graph", {
        cwd: repo,
        runId: index!.runId,
        nodeTypes: ["claim"],
        concerns: ["authentication"],
        limit: 2,
      });
      expect(claims.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "claim",
            summary: expect.stringContaining("external OAuth"),
          }),
        ]),
      );

      const claim = claims.items.find((item) => item.summary.includes("external OAuth"))!;
      const detail = await callMcp<NodeDetail>("architecture.get_assessment_node", {
        cwd: repo,
        runId: index!.runId,
        nodeId: claim.id,
        includeEdges: true,
        edgeLimit: 10,
      });
      expect(detail.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ relation: "supports", from: expect.stringMatching(/^evidence:/) }),
        ]),
      );

      const repeatResponse = await rawMcp("architecture.capture_assessment", {
        cwd: repo,
        now: "2026-05-01T11:05:00.000Z",
      });
      const repeatText = (repeatResponse?.result as { content?: Array<{ text?: string }> } | undefined)
        ?.content?.[0]?.text ?? "";
      const repeatParsed = JSON.parse(repeatText) as ToolResult<AssessmentIndexResult>;
      expect(repeatParsed.ok).toBe(true);
      const repeatIndex = repeatParsed.ok ? repeatParsed.result : undefined;
      expect(repeatIndex).toMatchObject({
        previousRunId: index!.runId,
        orientation: {
          state: "existing_context",
          shouldShowPreamble: false,
          repeatNote: expect.stringContaining("do not repeat the full preamble"),
        },
      });
      expect(repeatIndex!.orientation.preamble).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("keeps read-only assessment from creating persistence files", () => {
    const repo = tempRepo();
    try {
      const text = runSelectedCommand(
        { event: { ...thresholdEvent, cwd: repo } },
        { command: "assess", output: "text", readOnly: true },
        runtime(repo),
      );
      expect(text).toContain("Action:");
      expect(existsSync(join(repo, ".ceetrix", "tech-lead"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("creates an exploratory pack for an empty repository", () => {
    const repo = tempRepo();
    try {
      const text = runSelectedCommand(
        { cwd: repo, request: "Assess this empty brownfield repository" },
        { command: "capture", output: "text", readOnly: false, repo },
        runtime(repo),
      );
      expect(text).toContain("Durable record: created");
      const questions = readArtifactJson<{ open: unknown[] }>(
        join(repo, ".ceetrix", "tech-lead", "questions.json"),
      );
      expect(Array.isArray(questions.open)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("preserves prior artifacts when a later capture cannot be persisted", () => {
    const repo = tempRepo();
    try {
      const result = runSelectedCommand(
        { event: { ...thresholdEvent, cwd: repo } },
        { command: "capture", output: "json", readOnly: false, repo },
        runtime(repo),
      );
      const parsed = JSON.parse(result) as CaptureAssessmentResult;
      assertDurableAssessmentPack(parsed);
      const previousSummary = parsed.artifactPaths!.latestAssessmentMd;
      writeFileSync(join(repo, ".ceetrix", "tech-lead", "tech-lead.db"), "not a sqlite database", "utf8");

      const failed = runSelectedCommand(
        { event: { ...thresholdEvent, cwd: repo } },
        { command: "capture", output: "json", readOnly: false, repo },
        runtime(repo),
      );
      const failedParsed = JSON.parse(failed) as CaptureAssessmentResult;
      expect(failedParsed.durableRecordCreated).toBe(false);
      expect(existsSync(previousSummary)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

async function callMcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await rawMcp(name, args);
  const text = (response?.result as { content?: Array<{ text?: string }> } | undefined)
    ?.content?.[0]?.text;
  if (!text) {
    throw new Error(`MCP response missing text: ${JSON.stringify(response)}`);
  }
  const result = JSON.parse(text) as ToolResult<T>;
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.result;
}

async function rawMcp(name: string, args: Record<string, unknown>) {
  return handleMcpJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });
}

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "archcoach-persistence-e2e-"));
}

function runtime(cwd: string) {
  return {
    cwd,
    readFile: (path: string) => {
      throw new Error(`unexpected readFile: ${path}`);
    },
    fileExists: () => true,
  };
}
