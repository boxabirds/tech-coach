import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleCodexHookEvent,
  normalizeCodexLifecycleEvent,
  readCodexConfigFromEnv,
  renderCodexHookOutput,
} from "./hookAdapter.js";

describe("Codex lifecycle hook adapter", () => {
  it("normalizes supported Codex hook events and rejects unsupported events", () => {
    for (const kind of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
    ] as const) {
      expect(normalizeCodexLifecycleEvent({
        hook_event_name: kind,
        cwd: process.cwd(),
      })).toMatchObject({ kind, changedFiles: [] });
    }

    expect(() => normalizeCodexLifecycleEvent({
      hook_event_name: "PostToolBatch",
      cwd: process.cwd(),
    })).toThrow(/unsupported hook event/);
    expect(() => normalizeCodexLifecycleEvent({
      hook_event_name: "UserPromptSubmit",
    })).toThrow(/cwd is required/);
  });

  it("injects SessionStart context through the shared lifecycle handler", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-session-"));
    try {
      mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
      writeFileSync(
        join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
        "Action: Add test harness\nReason: Codex local guidance exists\n",
      );

      const response = handleCodexHookEvent({
        hook_event_name: "SessionStart",
        cwd: repo,
        session_id: "codex-session",
      });

      expect(response.effect).toBe("inject");
      expect(response.message).toContain("Here is the saved project context to use before answering:");
      expect(response.audit).toMatchObject({
        kind: "SessionStart",
        cwd: repo,
        effect: "inject",
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps Codex PostToolUse quiet by default", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-tools-"));
    const response = handleCodexHookEvent(
      {
        hook_event_name: "PostToolUse",
        cwd: repo,
        prompt: "Add project sharing",
        tool_name: "apply_patch",
        tool_use_id: "tool-1",
        changed_files: ["src/storage.ts"],
      },
      { mode: "strict" },
    );

    try {
      expect(response.effect).toBe("none");
      expect(response.message).toBeUndefined();
      expect(response.audit).toMatchObject({
        kind: "PostToolBatch",
        cwd: repo,
        effect: "none",
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("honors the Stop loop guard and renders Codex stop continuation JSON", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-stop-"));
    try {
      const response = handleCodexHookEvent({
        hook_event_name: "Stop",
        cwd: repo,
        stop_hook_active: true,
      });

      expect(response.effect).toBe("none");
      expect(renderCodexHookOutput("Stop", response)).toBe("{\n  \"continue\": true\n}\n");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("renders Codex hook output for inject and block responses", () => {
    expect(renderCodexHookOutput("UserPromptSubmit", {
      effect: "inject",
      message: "Use Tech Lead graph context.",
    })).toBe([
      "{",
      "  \"hookSpecificOutput\": {",
      "    \"hookEventName\": \"UserPromptSubmit\",",
      "    \"additionalContext\": \"Use Tech Lead graph context.\"",
      "  }",
      "}\n",
    ].join("\n"));
    expect(renderCodexHookOutput("PermissionRequest", {
      effect: "block",
      message: "Resolve the architecture gate first.",
    })).toContain("\"behavior\": \"deny\"");
    expect(renderCodexHookOutput("UserPromptSubmit", { effect: "none" })).toBe("");
  });

  it("reads Codex-specific mode env before defaulting to advisory", () => {
    expect(readCodexConfigFromEnv({ CODEX_TECH_LEAD_MODE: "strict" })).toEqual({ mode: "strict" });
    expect(readCodexConfigFromEnv({ ARCHCOACH_MODE: "balanced" })).toEqual({ mode: "balanced" });
    expect(readCodexConfigFromEnv({ CODEX_TECH_LEAD_MODE: "unknown" })).toEqual({ mode: "advisory" });
  });
});
