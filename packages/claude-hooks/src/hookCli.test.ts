import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TechLeadPersistenceStore } from "../../persistence/src/store.js";

const repoRoot = process.cwd();
const hookBin = join(repoRoot, "bin", "archcoach-hook");
const canReadBunSqlite = Boolean(process.versions.bun);

describe("archcoach-hook command", () => {
  it("executes SessionStart and emits Claude hook JSON when memory exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-hook-cli-"));
    try {
      mkdirSync(join(repo, ".ceetrix", "tech-lead"), { recursive: true });
      writeFileSync(
        join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"),
        "Action: Add test harness\nReason: package boundary is visible\n",
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

  it("executes Stop with no output when advisory mode allows completion", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-hook-stop-"));
    try {
      const result = spawnSync(hookBin, ["Stop"], {
        input: JSON.stringify({ cwd: repo }),
        encoding: "utf8",
        timeout: 5000,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(existsSync(join(repo, ".ceetrix", "tech-lead", "tech-lead.db"))).toBe(true);
      if (canReadBunSqlite) {
        const store = new TechLeadPersistenceStore(repo);
        expect(store.listLifecycleAudit()).toContainEqual(
          expect.objectContaining({ kind: "Stop", mode: "advisory", effect: "none" }),
        );
        store.close();
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("degrades malformed hook input to a concise diagnostic in balanced mode", () => {
    const result = spawnSync(hookBin, ["UserPromptSubmit"], {
      input: JSON.stringify({ prompt: "Add sharing" }),
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, ARCHCOACH_MODE: "balanced" },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: expect.stringContaining("Malformed Tech Lead hook input."),
      },
    });
  });
});
