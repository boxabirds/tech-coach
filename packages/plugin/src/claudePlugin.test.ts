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
    expect(report.hooksConfig).toMatchObject({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.sh",
              },
            ],
          },
        ],
        PostToolBatch: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-batch.sh",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh",
              },
            ],
          },
        ],
      },
    });
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

    expect(skillText).toContain("## First-Use Orientation");
    expect(skillText).toContain("orientation.shouldShowPreamble");
    expect(skillText).toContain("Ceetrix Tech Lead helps keep structure proportional");
    expect(skillText).toContain("repo-local `bun:sqlite` persistence");
    expect(skillText).toContain("durable local source of truth");
    expect(skillText).toContain("generated reports, indexes, or exports");
    expect(skillText).toContain("do not repeat the full preamble");
    expect(skillText).toContain("Do not start by offering a menu of assessment modes");
    expect(skillText).toContain("Preserve each `question.id` exactly");
    expect(skillText).toContain("Do not answer the questions yourself");
    expect(skillText).toContain("Do not fabricate missing preferences");
    expect(skillText).toContain("Do not show raw question ids");
    expect(skillText).toContain("architecture.apply_interview_answers");
    expect(skillText).toContain("architecture.capture_assessment");
    expect(skillText).toContain("architecture.query_assessment_graph");
    expect(skillText).toContain("architecture.get_assessment_node");
    expect(skillText).toContain("Capture returns a bounded assessment graph index");
    expect(skillText).toContain("architecture.answer_question");
    expect(skillText).toContain("Prior decision records are optional context");
    expect(skillText).toContain("Never describe the assessment as empty");
    expect(skillText).toContain("## Inline And Follow-Up Architecture Questions");
    expect(skillText).toContain("When the user invokes this skill with trailing text");
    expect(skillText).toContain("normal follow-up architecture");
    expect(skillText).toContain("architecture.query_assessment_graph");
    expect(skillText).toContain("Answer with a grounded default recommendation before asking questions");
    expect(skillText).toContain("Do not lead with a broad clarification interview");
    expect(skillText).toContain("\"questionId\"");
    expect(skillText).toContain("Allowed `action` values");
  });

  it("keeps first-use orientation as a concise Claude text surface", () => {
    const { skillText } = inspectClaudePluginAssets(repoRoot);
    const section = skillText.slice(
      skillText.indexOf("## First-Use Orientation"),
      skillText.indexOf("## Default Behavior"),
    );

    expect(section.length).toBeLessThan(2_500);
    expect(section).toContain("briefly orient the user before the recommendation");
    expect(section).toContain("then continue into the assessment");
    expect(section).toContain("run the coach");
    expect(section).toContain("answer follow-up questions only when the current work needs them");
    expect(section).toContain("confirm durable decisions");
    expect(section).not.toContain("[question-");
    expect(section).not.toContain("Choose one of these modes");
    expect(skillText.indexOf("## First-Use Orientation")).toBeLessThan(
      skillText.indexOf("## Default Behavior"),
    );
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
          expect.objectContaining({ name: "architecture.capture_assessment" }),
          expect.objectContaining({ name: "architecture.query_assessment_graph" }),
          expect.objectContaining({ name: "architecture.get_assessment_node" }),
          expect.objectContaining({ name: "architecture.apply_interview_answers" }),
          expect.objectContaining({ name: "architecture.answer_question" }),
        ]),
      },
    });
  });
});
