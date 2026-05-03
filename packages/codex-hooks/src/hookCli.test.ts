import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const hookBin = join(repoRoot, "bin", "archcoach-codex-hook");

describe("archcoach-codex-hook command", () => {
  it("executes SessionStart and emits Codex hook JSON when memory exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-hook-cli-"));
    try {
      mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
      writeFileSync(
        join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
        "Action: Add test harness\nReason: Codex support is local\n",
      );

      const result = spawnSync(hookBin, ["SessionStart"], {
        input: JSON.stringify({ cwd: repo }),
        encoding: "utf8",
        timeout: 5000,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: expect.stringContaining("Action: Add test harness"),
        },
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("executes Stop with Codex continuation JSON when the loop guard is active", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-hook-stop-"));
    try {
      const result = spawnSync(hookBin, ["Stop"], {
        input: JSON.stringify({ cwd: repo, stop_hook_active: true }),
        encoding: "utf8",
        timeout: 5000,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns a concise CLI error for malformed local hook input", () => {
    const result = spawnSync(hookBin, ["UserPromptSubmit"], {
      input: JSON.stringify({ prompt: "Add sharing" }),
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cwd is required");
  });
});
