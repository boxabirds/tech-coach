import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  inspectClaudePluginAssets,
  validateClaudePluginOptions,
} from "./claudePlugin.js";

const repoRoot = process.cwd();

describe("Claude Code plugin assets", () => {
  it("packages a loadable Claude Code plugin with safe local defaults", () => {
    const report = inspectClaudePluginAssets(repoRoot);

    expect(report.issues).toEqual([]);
    expect(report.manifest).toMatchObject({
      name: "tech-coach",
      skills: "./skills/",
      hooks: "./hooks/hooks.json",
      mcpServers: "./.mcp.json",
    });
    expect(report.manifest.userConfig).toMatchObject({
      coach_mode: { default: "advisory" },
      memory_location: { default: "project" },
      evaluator: { default: "local" },
      external_token: { sensitive: true },
    });
    expect(report.mcpConfig).toMatchObject({
      mcpServers: {
        "tech-coach": {
          command: "${CLAUDE_PLUGIN_ROOT}/bin/archcoach-mcp",
          cwd: "${CLAUDE_PLUGIN_ROOT}",
        },
      },
    });
    expect(report.hooksConfig).toEqual({ hooks: {} });
    expect(report.settings).toEqual({});
  });

  it("validates configured preferences and external evaluator requirements", () => {
    expect(validateClaudePluginOptions({})).toEqual([]);
    expect(validateClaudePluginOptions({
      coach_mode: "strict",
      memory_location: "external",
      evaluator: "external",
      external_endpoint: "https://coach.example.test",
    })).toEqual([]);

    expect(validateClaudePluginOptions({
      coach_mode: "maximal",
      memory_location: "global",
      evaluator: "external",
    })).toEqual([
      { field: "coach_mode", message: "must be advisory, balanced, or strict" },
      { field: "memory_location", message: "must be project, user, or external" },
      { field: "external_endpoint", message: "is required when evaluator is external" },
    ]);
  });

  it("instructs Claude to mediate interviews instead of inventing answers", () => {
    const { skillText } = inspectClaudePluginAssets(repoRoot);

    expect(skillText).toContain("Preserve each `question.id` exactly");
    expect(skillText).toContain("Do not answer the questions yourself");
    expect(skillText).toContain("Do not fabricate missing preferences");
    expect(skillText).toContain("architecture.apply_interview_answers");
    expect(skillText).toContain("\"questionId\"");
    expect(skillText).toContain("Allowed `action` values");
  });

  it("exposes coach MCP tools through the plugin launcher", () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    };
    const result = spawnSync(join(repoRoot, "bin", "archcoach-mcp"), {
      input: `${JSON.stringify(request)}\n`,
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "architecture.assess_change" }),
          expect.objectContaining({ name: "architecture.apply_interview_answers" }),
        ]),
      },
    });
  });
});
