import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import {
  collectClaudeHookTelemetry,
  handleClaudeHookEvent,
  normalizeClaudeLifecycleEvent,
  renderClaudeHookOutput,
} from "./hookAdapter.js";

describe("Claude lifecycle hook adapter", () => {
  it("normalizes Claude hook JSON into a shared lifecycle event", () => {
    const event = normalizeClaudeLifecycleEvent({
      hook_event_name: "UserPromptSubmit",
      cwd: process.cwd(),
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "Add project sharing",
    });

    expect(event).toMatchObject({
      kind: "UserPromptSubmit",
      sessionId: "session-1",
      transcriptPath: "/tmp/transcript.jsonl",
      userRequest: "Add project sharing",
      changedFiles: [],
    });
    expect(event.cwd).toBe(process.cwd());
  });

  it("injects compact SessionStart context when project memory exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-session-"));
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(
      join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
      ["# Latest Assessment", "", "Action: Insert boundary", "Reason: persistence is load-bearing"].join("\n"),
    );

    const response = handleClaudeHookEvent({
      hook_event_name: "SessionStart",
      cwd: repo,
      session_id: "session-1",
    });

    expect(response.effect).toBe("inject");
    expect(response.message).toContain("Tech Lead architecture context");
    expect(response.message).toContain("Action: Insert boundary");
  });

  it("stays silent on SessionStart when there is no useful memory", () => {
    const response = handleClaudeHookEvent({
      hook_event_name: "SessionStart",
      cwd: mkdtempSync(join(tmpdir(), "tech-lead-empty-session-")),
    });

    expect(response.effect).toBe("none");
  });

  it("injects a pre-planning signpost and preserves interview question IDs", () => {
    const assessment = assessmentFixture({
      action: "Insert boundary",
      reason: "Prior persistence shortcut matched a sharing revisit trigger.",
      questions: [{
        id: "question-data-sharing",
        concern: "data_storage",
        kind: "choose",
        prompt: "Does sharing need real multi-user access control?",
        reason: "Sharing changes persistence responsibility.",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
        options: [],
      }],
    });

    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "Let teammates share projects",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessment,
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.message).toContain("Architecture signpost: Insert boundary.");
    expect(response.message).toContain("[question-data-sharing]");
    expect(response.message).toContain("Preserve the question IDs");
    expect(response.interviewRequired?.map((question) => question.id)).toEqual([
      "question-data-sharing",
    ]);
  });

  it("does not surface low-risk Continue results", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "Change the button label",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Continue",
          intervention: "note",
          reason: "Current evidence does not require adding structure yet.",
        }),
      },
    );

    expect(response.effect).toBe("none");
  });

  it("injects PostToolBatch drift feedback once per batch", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "PostToolBatch",
        cwd: process.cwd(),
        tool_calls: [
          { tool_name: "Bash", tool_input: { command: "printf hi > src/storage.ts" } },
        ],
      },
      { mode: "balanced" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Split module",
          reason: "Current evidence shows broad change or risk hotspot pressure.",
          evidence: [{
            source: "event.changedFiles",
            category: "changed_file_spread",
            summary: "Change touches src/storage.ts, src/App.tsx, and config.",
          }],
        }),
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.message).toContain("Architecture signpost: Split module.");
    expect(response.message).toContain("Change touches src/storage.ts");
  });

  it("collects shell-created changed files for PostToolBatch telemetry", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-git-drift-"));
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    execFileSync("git", ["add", "package.json"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "ignore" });
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "storage.ts"), "export const storage = new Map();\n");

    const event = normalizeClaudeLifecycleEvent({
      hook_event_name: "PostToolBatch",
      cwd: repo,
      tool_calls: [
        { tool_name: "Bash", tool_input: { command: "printf ... > src/storage.ts" } },
      ],
    });
    const collected = collectClaudeHookTelemetry(event, "2026-05-01T00:00:00.000Z");

    expect(collected.event.changedFiles).toContain("src/storage.ts");
    expect(collected.telemetry.change.some((signal) =>
      signal.payload.changedFiles.includes("src/storage.ts")
    )).toBe(true);
  });

  it("uses a Stop loop guard and delegates completion policy", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "Stop",
        cwd: process.cwd(),
      },
      { mode: "strict" },
      { env: { ARCHCOACH_STOP_HOOK_ACTIVE: "1" } },
    );

    expect(response.effect).toBe("none");
  });

  it("renders Claude-valid hook output for injected context and blocks", () => {
    expect(JSON.parse(renderClaudeHookOutput("UserPromptSubmit", {
      effect: "inject",
      message: "Architecture signpost",
    }))).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "Architecture signpost",
      },
    });

    expect(JSON.parse(renderClaudeHookOutput("UserPromptSubmit", {
      effect: "block",
      message: "Stop and decide",
    }))).toEqual({
      decision: "block",
      reason: "Stop and decide",
    });
  });
});

function collectFixture(): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
} {
  return {
    event: {
      host: "claude-code",
      event: "UserPromptSubmit",
      cwd: process.cwd(),
      recentRequests: [],
      changedFiles: [],
      repoSignals: { status: "absent" },
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    },
    telemetry: {
      lifecycle: [],
      repository: [],
      change: [],
      test: [],
      memory: [],
      runtime: [],
      diagnostics: [],
    },
  };
}

function assessmentFixture(overrides: Partial<AssessmentResult>): AssessmentResult {
  return {
    status: "needs_attention",
    intervention: "recommend",
    action: "Record decision",
    reason: "Baseline has unconfirmed assumptions.",
    evidence: [],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    baseline: {
      repoRoot: process.cwd(),
      generatedAt: "2026-05-01T00:00:00.000Z",
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    questions: [],
    revisitAlerts: [],
    principleGuidance: [],
    ...overrides,
  };
}
