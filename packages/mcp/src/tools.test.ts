import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleMcpJsonRpc } from "../../../mcp/server/index.js";
import {
  applyInterviewAnswers,
  invokeArchitectureTool,
  listArchitectureTools,
  planInterview,
  type AssessmentToolResult,
} from "./tools.js";
import {
  decisionToRecord,
  largeDiffTelemetry,
  malformedTelemetry,
  noActionEvent,
  revisitInput,
  thresholdEvent,
  thresholdTelemetry,
} from "./__fixtures__/inputs.js";

describe("architecture MCP tool contracts", () => {
  it("lists stable architecture tool descriptors", () => {
    expect(listArchitectureTools().map((tool) => tool.name)).toEqual([
      "architecture.assess_change",
      "architecture.plan_interview",
      "architecture.apply_interview_answers",
      "architecture.horizon_scan",
      "architecture.review_structure",
      "architecture.record_decision",
      "architecture.check_revisit_triggers",
      "architecture.get_memory",
      "architecture.scan_repository",
    ]);
  });

  it("returns telemetry-aware assessment guidance and a host-mediated interview contract", () => {
    const result = invokeArchitectureTool("architecture.assess_change", { telemetry: thresholdTelemetry });

    expect(result.ok).toBe(true);
    const guidance = result.ok ? result.result as AssessmentToolResult : undefined;
    expect(guidance?.assessment).toMatchObject({
      status: "needs_attention",
      action: "Record decision",
    });
    expect(guidance?.assessment.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "repository",
          source: "layout",
        }),
      ]),
    );
    expect(guidance?.interview).toMatchObject({
      hostMediated: true,
      answerContract: {
        tool: "architecture.apply_interview_answers",
        answerShape: "BaselineAnswer[]",
      },
    });
    expect(guidance?.interview.answerContract.instruction).toContain("Do not answer");
  });

  it("accepts legacy event input and represents no-action guidance cleanly", () => {
    const result = invokeArchitectureTool("architecture.assess_change", { event: noActionEvent });

    expect(result.ok).toBe(true);
    const guidance = result.ok ? result.result as AssessmentToolResult : undefined;
    expect(guidance?.assessment).toMatchObject({
      status: "ok",
      action: "Continue",
    });
    expect(guidance?.interview.questions).toEqual([]);
  });

  it("plans interviews and applies host-collected answers without writing memory", () => {
    const assessmentResult = invokeArchitectureTool("architecture.assess_change", {
      event: thresholdEvent,
    });
    expect(assessmentResult.ok).toBe(true);
    const guidance = assessmentResult.ok ? assessmentResult.result as AssessmentToolResult : undefined;
    const questions = planInterview({
      baseline: guidance!.assessment.baseline,
      telemetry: thresholdTelemetry,
      limit: 2,
    });

    expect(questions.length).toBeGreaterThan(0);
    const updated = applyInterviewAnswers({
      baseline: guidance!.assessment.baseline,
      questions,
      answers: [{
        questionId: questions[0].id,
        action: "confirm",
        value: "Confirmed by user in the host conversation",
      }],
      recordedAt: "2026-04-30T14:30:00.000Z",
    });

    expect(updated.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: questions[0].id,
        status: "user_confirmed",
      }),
    );
  });

  it("keeps assessment and interview planning read-only against memory", () => {
    const root = tempRoot();
    const memoryPath = join(root, ".archcoach", "memory.jsonl");

    try {
      const assessment = invokeArchitectureTool("architecture.assess_change", {
        event: thresholdEvent,
        memoryPath,
      });
      expect(assessment.ok).toBe(true);
      expect(existsSync(memoryPath)).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes memory only through explicit record_decision", () => {
    const root = tempRoot();
    const memoryPath = join(root, "memory.jsonl");

    try {
      const result = invokeArchitectureTool("architecture.record_decision", {
        repoRoot: root,
        memoryPath,
        decision: decisionToRecord,
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(memoryPath, "utf8")).toContain("decision-mcp-storage");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks revisit triggers using current evidence and explicit memory records", () => {
    const result = invokeArchitectureTool("architecture.check_revisit_triggers", revisitInput);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.result : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: "decision-localstorage-projects",
          recommendedAction: "Replace substrate",
        }),
      ]),
    );
  });

  it("returns structured errors for malformed telemetry and malformed tool input", () => {
    const telemetryError = invokeArchitectureTool("architecture.assess_change", {
      telemetry: malformedTelemetry,
    });
    const inputError = invokeArchitectureTool("architecture.plan_interview", {});

    expect(telemetryError).toMatchObject({
      ok: false,
      error: {
        code: "invalid_telemetry",
        field: "repository[0].family",
      },
    });
    expect(inputError).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        field: "input.baseline",
      },
    });
  });

  it("returns diagnostics for malformed or unknown interview answers without inventing answers", () => {
    const assessmentResult = invokeArchitectureTool("architecture.assess_change", {
      event: thresholdEvent,
    });
    expect(assessmentResult.ok).toBe(true);
    const guidance = assessmentResult.ok ? assessmentResult.result as AssessmentToolResult : undefined;

    const missingAnswers = invokeArchitectureTool("architecture.apply_interview_answers", {
      baseline: guidance!.assessment.baseline,
      questions: guidance!.interview.questions,
    });
    const unknownQuestion = invokeArchitectureTool("architecture.apply_interview_answers", {
      baseline: guidance!.assessment.baseline,
      questions: guidance!.interview.questions,
      answers: [{
        questionId: "question-does-not-exist",
        action: "confirm",
        value: "host answer",
      }],
    });

    expect(missingAnswers).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        field: "input.answers",
      },
    });
    expect(unknownQuestion.ok).toBe(true);
    expect(unknownQuestion.ok ? unknownQuestion.result : undefined).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          source: "baselineMerge",
        }),
      ]),
    });
  });

  it("returns structured memory errors when memory is unavailable", () => {
    const result = invokeArchitectureTool(
      "architecture.get_memory",
      { repoRoot: "/repo" },
      {
        readMemory: () => ({
          records: [],
          diagnostics: [{
            id: "memory-unavailable",
            severity: "error",
            source: "/repo/.archcoach/memory.jsonl",
            message: "memory could not be read",
          }],
        }),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "memory_failure",
        message: "memory could not be read",
      },
    });
  });

  it("handles large diff summary telemetry through horizon and structure review tools", () => {
    const horizon = invokeArchitectureTool("architecture.horizon_scan", {
      telemetry: largeDiffTelemetry,
    });
    const review = invokeArchitectureTool("architecture.review_structure", {
      telemetry: largeDiffTelemetry,
    });

    expect(horizon.ok).toBe(true);
    expect(horizon.ok ? horizon.result : undefined).toMatchObject({
      action: "Record decision",
    });
    expect(review.ok).toBe(true);
    expect(review.ok ? review.result : undefined).toMatchObject({
      baseline: {
        concerns: expect.arrayContaining([
          expect.objectContaining({ concern: "risk_hotspot" }),
        ]),
      },
    });
  });

  it("supports minimal MCP JSON-RPC tools/list and tools/call", async () => {
    const list = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const call = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "architecture.assess_change",
        arguments: { event: noActionEvent },
      },
    });

    expect(list?.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "architecture.assess_change" }),
      ]),
    });
    expect(call?.result).toMatchObject({
      content: [expect.objectContaining({ type: "text" })],
      isError: false,
    });
  });
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "archcoach-mcp-"));
}
