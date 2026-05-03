import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import { telemetryFromEvent } from "../../kernel/src/telemetry.js";
import { projectAnswerSemantics } from "../../kernel/src/policy.js";
import { applyBaselineAnswers } from "../../kernel/src/baselineMerge.js";
import {
  applyAnswersForInterface,
  checkAnswerSemanticsConsistency,
  checkGuidanceConsistency,
  runPortableAssessment,
  type PortableAssessmentCase,
} from "./consistency.js";
import {
  assessClaudeCodeEvent,
  normalizeClaudeCodeEvent,
  type ClaudeCodeEventInput,
} from "./claude.js";
import {
  assessCodexEvent,
  normalizeCodexEvent,
  type CodexEventInput,
} from "./codex.js";
import {
  assessGenericCiEvent,
  normalizeGenericCiEvent,
  type GenericCiEventInput,
} from "./generic.js";

type PortabilityFixture = {
  event: CoachEventEnvelope;
  claude: ClaudeCodeEventInput;
  codex: CodexEventInput;
  genericCi: GenericCiEventInput;
};

const fixture = readFixture("equivalent-assessment.json");

describe("portable architecture guidance consistency", () => {
  it("produces equivalent guidance across CLI, MCP, Claude, Codex, and generic CI adapters", () => {
    const cases = equivalentCases();
    const result = checkGuidanceConsistency(cases);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.outputs.map((output) => output.interface)).toEqual([
      "cli",
      "mcp",
      "claude",
      "codex",
      "generic_ci",
    ]);
    for (const output of result.outputs) {
      expect(output.guidance).toMatchObject({
        status: "needs_attention",
        intervention: "recommend",
        action: expect.stringMatching(/Insert boundary|Add test harness/),
      });
      expect(output.guidance.evidence.length).toBeGreaterThan(0);
      expect(output.guidance.questions.length).toBeGreaterThan(0);
    }
  });

  it("preserves host-collected answer semantics across all interfaces", () => {
    const output = runPortableAssessment(equivalentCases()[0]);
    const answers = [{
      questionId: output.questions[0].id,
      action: "confirm" as const,
      value: "Confirmed by the user through the host interface",
      answerId: "answer-portable-confirm",
    }];

    const result = checkAnswerSemanticsConsistency(output, answers);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.projections.mcp.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: output.questions[0].id,
        status: "user_confirmed",
      }),
    );
  });

  it("leaves unanswered required questions unresolved instead of inventing answers", () => {
    const output = runPortableAssessment(equivalentCases()[0]);

    const direct = projectAnswerSemantics(
      applyBaselineAnswers({
        baseline: output.baseline,
        questions: output.questions,
        answers: [],
        recordedAt: "2026-04-30T18:00:00.000Z",
      }),
    );
    const mcp = applyAnswersForInterface("mcp", output.baseline, output.questions, []);

    expect(mcp).toEqual(direct);
    expect(mcp.confirmations).toEqual([]);
  });

  it("returns diagnostics for unknown question ids consistently", () => {
    const output = runPortableAssessment(equivalentCases()[0]);
    const answers = [{
      questionId: "question-does-not-exist",
      action: "confirm" as const,
      value: "Host answer",
      answerId: "answer-unknown-question",
    }];

    const result = checkAnswerSemanticsConsistency(output, answers, ["cli", "mcp"]);

    expect(result.ok).toBe(true);
    expect(result.projections.cli.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        source: "baselineMerge",
        message: expect.stringContaining("unknown question"),
      }),
    );
  });

  it("accepts missing optional host fields while keeping defaults explicit", () => {
    expect(normalizeClaudeCodeEvent({
      cwd: "/repo",
      hook_event_name: "UserPromptSubmit",
    })).toMatchObject({
      host: "claude-code",
      event: "UserPromptSubmit",
      recentRequests: [],
      changedFiles: [],
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    });
    expect(normalizeGenericCiEvent({
      cwd: "/repo",
    })).toMatchObject({
      host: "generic-ci",
      event: "ci-check",
      recentRequests: [],
      changedFiles: [],
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    });
    expect(normalizeCodexEvent({
      cwd: "/repo",
    })).toMatchObject({
      host: "codex",
      event: "UserPromptSubmit",
      recentRequests: [],
      changedFiles: [],
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    });
  });

  it("rejects schema mismatches before producing guidance", () => {
    expect(() => normalizeClaudeCodeEvent({
      hook_event_name: "PostToolBatch",
    })).toThrow(/cwd: is required/);
    expect(() => normalizeGenericCiEvent({
      cwd: "/repo",
      changedFiles: ["src/app.ts", 42] as never,
    })).toThrow(/changedFiles\[1\]: must be a string/);
    expect(() => normalizeCodexEvent({
      cwd: "/repo",
      changedFiles: ["src/app.ts", 42] as never,
    })).toThrow(/changedFiles\[1\]: must be a string/);
  });

  it("rejects telemetry mismatches before comparing guidance", () => {
    const telemetry = telemetryFromEvent(fixture.event);
    const malformedTelemetry = {
      ...telemetry,
      repository: telemetry.repository.map((signal, index) => index === 0
        ? { ...signal, family: "change" }
        : signal),
    };

    expect(() => assessClaudeCodeEvent({
      ...fixture.claude,
      telemetry: malformedTelemetry as never,
    })).toThrow(/repository\[0\]\.family: must be repository/);
    expect(() => assessGenericCiEvent({
      ...fixture.genericCi,
      telemetry: malformedTelemetry as never,
    })).toThrow(/repository\[0\]\.family: must be repository/);
    expect(() => assessCodexEvent({
      ...fixture.codex,
      telemetry: malformedTelemetry as never,
    })).toThrow(/repository\[0\]\.family: must be repository/);
  });

  it("does not mutate memory artifacts when an adapter input fails", () => {
    const root = mkdtempSync(join(tmpdir(), "archcoach-portability-"));
    const memoryPath = join(root, "memory.jsonl");
    writeFileSync(memoryPath, "existing durable memory\n", "utf8");

    try {
      expect(() => runPortableAssessment({
        interface: "claude",
        input: { hook_event_name: "PostToolBatch" },
      })).toThrow(/cwd: is required/);
      expect(existsSync(memoryPath)).toBe(true);
      expect(readFileSync(memoryPath, "utf8")).toBe("existing durable memory\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function equivalentCases(): PortableAssessmentCase[] {
  const telemetry = telemetryFromEvent(fixture.event, {
    capturedAt: "2026-04-30T18:00:00.000Z",
    correlationId: "portable-equivalent",
  });
  return [
    { interface: "cli", input: { event: fixture.event, telemetry } },
    { interface: "mcp", input: { event: fixture.event, telemetry } },
    { interface: "claude", input: { ...fixture.claude, telemetry } },
    { interface: "codex", input: { ...fixture.codex, telemetry } },
    { interface: "generic_ci", input: { ...fixture.genericCi, telemetry } },
  ];
}

function readFixture(name: string): PortabilityFixture {
  const path = join(process.cwd(), "fixtures", "portability", name);
  return JSON.parse(readFileSync(path, "utf8")) as PortabilityFixture;
}
