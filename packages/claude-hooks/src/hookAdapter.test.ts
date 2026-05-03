import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { UsageEventInput } from "../../kernel/src/usageEvents.js";
import {
  collectClaudeHookTelemetry,
  effectForAssessment,
  handleClaudeHookEvent,
  isArchitectureRelevantPrompt,
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

  it("normalizes all supported Claude lifecycle events and rejects unsupported events", () => {
    for (const kind of ["SessionStart", "UserPromptSubmit", "PostToolBatch", "Stop"] as const) {
      expect(normalizeClaudeLifecycleEvent({
        hook_event_name: kind,
        cwd: process.cwd(),
      })).toMatchObject({ kind });
    }

    expect(() => normalizeClaudeLifecycleEvent({
      hook_event_name: "PreToolUse",
      cwd: process.cwd(),
    })).toThrow(/unsupported hook event/);
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
    expect(response.message).toContain("Here is the saved project context to use before answering:");
    expect(response.message).toContain("Action: Insert boundary");
  });

  it("stays silent on SessionStart when there is no useful memory", () => {
    const response = handleClaudeHookEvent({
      hook_event_name: "SessionStart",
      cwd: mkdtempSync(join(tmpdir(), "tech-lead-empty-session-")),
    });

    expect(response.effect).toBe("none");
  });

  it("classifies architecture follow-up prompts without making ordinary chat relevant", () => {
    expect(isArchitectureRelevantPrompt("how do I create a local-only version of Ceetrix")).toBe(true);
    expect(isArchitectureRelevantPrompt("what is the right storage boundary for this")).toBe(true);
    expect(isArchitectureRelevantPrompt("should we self-host the worker and database")).toBe(true);
    expect(isArchitectureRelevantPrompt("thanks, that makes sense")).toBe(false);
    expect(isArchitectureRelevantPrompt("rename this label to Projects")).toBe(false);
  });

  it("injects Tech Lead graph guidance for normal architecture follow-up after a baseline exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-follow-up-"));
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(
      join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
      [
        "# Ceetrix Tech Lead Assessment",
        "## Architecture Claims",
        "- data_storage: Persistent data is backed by local schema.",
        "- deployment: Hosted runtime evidence is present.",
      ].join("\n"),
    );

    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: repo,
        prompt: "how do I create a local-only version of Ceetrix?",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          status: "ok",
          action: "Continue",
          intervention: "note",
          reason: "Current evidence does not require adding structure yet.",
        }),
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.message).toContain("You already have useful project context for this question.");
    expect(response.message).toContain("architecture.query_assessment_graph");
    expect(response.message).toContain("plain-English default recommendation first");
  });

  it("records privacy-safe usage events for hook engagement", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-hook-usage-"));
    const usage: UsageEventInput[] = [];
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"), "# baseline\n");

    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: repo,
        session_id: "session-usage",
        prompt: "how do I create a local-only version of Ceetrix?",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          status: "ok",
          action: "Continue",
          intervention: "note",
          reason: "Current evidence does not require adding structure yet.",
        }),
        recordUsage: (record) => usage.push(record),
      },
    );

    expect(response.effect).toBe("inject");
    expect(usage).toEqual([
      expect.objectContaining({
        repoRoot: repo,
        sessionId: "session-usage",
        source: "hook",
        engagementType: "followup_injection",
        outcome: "engaged",
        metadata: expect.objectContaining({
          lifecycleKind: "UserPromptSubmit",
          effect: "inject",
        }),
      }),
    ]);
    expect(JSON.stringify(usage)).not.toContain("local-only version");
  });

  it("does not inject follow-up Tech Lead guidance for ordinary chat after a baseline exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-follow-up-chat-"));
    mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
    writeFileSync(join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"), "# baseline\n");

    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: repo,
        prompt: "thanks, that's useful",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          status: "ok",
          action: "Continue",
          intervention: "note",
          reason: "Current evidence does not require adding structure yet.",
        }),
      },
    );

    expect(response.effect).toBe("none");
  });

  it("injects plain-English pre-planning guidance and preserves interview question IDs internally", () => {
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
    expect(response.message).toMatch(/^This change looks like it needs a little architecture attention/);
    expect(response.message).toContain("Recommended move: Insert boundary.");
    expect(response.message).toContain("Does sharing need real multi-user access control?");
    expect(response.message).not.toContain("[question-data-sharing]");
    expect(response.message).toContain("Technical detail: keep the structured question ids");
    expect(response.interviewRequired?.map((question) => question.id)).toEqual([
      "question-data-sharing",
    ]);
    expect(response.audit).toMatchObject({
      kind: "UserPromptSubmit",
      mode: "advisory",
      effect: "inject",
      action: "Insert boundary",
      intervention: "recommend",
      questionIds: ["question-data-sharing"],
    });
  });

  it("applies the lifecycle mode matrix outside Stop gates", () => {
    expect(effectForAssessment("recommend", "advisory")).toBe("inject");
    expect(effectForAssessment("recommend", "balanced")).toBe("inject");
    expect(effectForAssessment("recommend", "strict")).toBe("block");
    expect(effectForAssessment("block", "balanced")).toBe("block");
    expect(effectForAssessment("block", "strict")).toBe("block");
  });

  it("blocks recommend-level findings in strict mode before planning continues", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "Add production sharing",
      },
      { mode: "strict" },
      {
        now: () => "2026-05-01T00:00:00.000Z",
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          intervention: "recommend",
          action: "Record decision",
          reason: "Baseline has a high-impact unconfirmed assumption.",
        }),
      },
    );

    expect(response.effect).toBe("block");
    expect(response.audit).toMatchObject({
      mode: "strict",
      effect: "block",
      action: "Record decision",
      intervention: "recommend",
      correlationId: "UserPromptSubmit-2026-05-01T00:00:00.000Z",
    });
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
    expect(response.audit).toMatchObject({
      kind: "UserPromptSubmit",
      effect: "none",
      action: "Continue",
      intervention: "note",
    });
  });

  it("stays quiet for greenfield product scoping in an empty repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-empty-greenfield-"));
    mkdirSync(join(repo, ".ceetrix"), { recursive: true });
    try {
      const response = handleClaudeHookEvent({
        hook_event_name: "UserPromptSubmit",
        cwd: repo,
        prompt: "help me make a miro clone",
      });

      expect(response.effect).toBe("none");
      expect(response.audit).toMatchObject({
        kind: "UserPromptSubmit",
        effect: "none",
        action: "Continue",
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("records compact audit records through an optional runtime sink", () => {
    const auditRecords: unknown[] = [];
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "PostToolBatch",
        cwd: process.cwd(),
      },
      { mode: "balanced" },
      {
        now: () => "2026-05-01T00:00:00.000Z",
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Split module",
          intervention: "recommend",
          evidence: [{
            family: "change",
            source: "event.changedFiles",
            category: "changed_file_spread",
            summary: "Change touches source and config boundaries.",
          }],
        }),
        recordAudit: (record) => auditRecords.push(record),
      },
    );

    expect(response.effect).toBe("inject");
    expect(auditRecords).toEqual([
      expect.objectContaining({
        kind: "PostToolBatch",
        mode: "balanced",
        effect: "inject",
        action: "Split module",
        intervention: "recommend",
        evidence: ["Change touches source and config boundaries."],
        degraded: false,
      }),
    ]);
  });

  it("degrades safely when audit persistence fails", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "Add sharing",
      },
      { mode: "balanced" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Record decision",
          intervention: "recommend",
        }),
        recordAudit: () => {
          throw new Error("store unavailable");
        },
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.audit).toMatchObject({
      kind: "UserPromptSubmit",
      effect: "inject",
    });
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
    expect(response.message).toContain("This change looks like it needs a little architecture attention");
    expect(response.message).toContain("Recommended move: Split module.");
    expect(response.message).toContain("Change touches src/storage.ts");
  });

  it("renders temporal basis in plain English when available", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "what should I do next",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Continue",
          reason: "Future-facing architecture evidence is available; use it as the planning anchor and current code as the feasibility check.",
          interactionContext: "requested_next_action",
          temporalBrief: {
            future: ["docs/design/tech-architecture.md: Bounded documentation describes architecture."],
            current: ["src/main.ts: Inventory includes src/main.ts"],
            past: ["pocs/old-lab/package.json: Inventory includes pocs/old-lab/package.json"],
            uncertain: [],
          },
        }),
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.message).toContain("Time basis:");
    expect(response.message).toContain("Future intent: docs/design/tech-architecture.md");
    expect(response.message).toContain("Current system: src/main.ts");
    expect(response.message).toContain("Past context: pocs/old-lab/package.json");
  });

  it("does not render unrelated package-boundary add-now text for broad reviews", () => {
    const response = handleClaudeHookEvent(
      {
        hook_event_name: "UserPromptSubmit",
        cwd: process.cwd(),
        prompt: "what should I do next",
      },
      { mode: "advisory" },
      {
        collectTelemetry: collectFixture,
        assess: () => assessmentFixture({
          action: "Run review",
          reason: "Current evidence shows broad change pressure.",
          evidence: [{ source: "event.changedFiles", category: "changed_file_spread", summary: "Broad dirty tree." }],
          policy: {
            concerns: [],
            selected: {
              concern: "risk_hotspot",
              action: "Run review",
              intervention: "recommend",
              reason: "Current evidence shows broad change pressure.",
              thresholdCandidates: ["blast_radius"],
              axes: {
                complexity: "medium",
                irreversibility: "medium",
                solutionVisibility: "medium",
                planningHorizon: "medium",
              },
              principleIds: [],
              doNotAdd: [],
              provisional: false,
              requiresQuestion: false,
            },
          },
          principleGuidance: [{
            concern: "package_boundary",
            principles: [],
            patterns: [{
              pattern: "add_targeted_test_harness",
              concern: "package_boundary",
              principleIds: [],
              addNow: "Add a small integration test around the React/TypeScript to Rust/WASM boundary before changing behavior across it.",
              doNotAddYet: "Do not split packages further.",
              evidence: [],
              missingEvidence: [],
              confidence: "medium",
            }],
          }],
        }),
      },
    );

    expect(response.effect).toBe("inject");
    expect(response.message).not.toContain("React/TypeScript to Rust/WASM boundary");
    expect(response.message).not.toContain("What to add now:");
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
    expect(response.audit).toMatchObject({
      kind: "Stop",
      effect: "none",
      reason: "Stop loop guard is already active.",
    });
  });

  it("renders Claude-valid hook output for injected context and blocks", () => {
    expect(JSON.parse(renderClaudeHookOutput("UserPromptSubmit", {
      effect: "inject",
      message: "This needs a small decision before you continue.",
    }))).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "This needs a small decision before you continue.",
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
    temporalBrief: { past: [], current: [], future: [], uncertain: [] },
    ...overrides,
  };
}
