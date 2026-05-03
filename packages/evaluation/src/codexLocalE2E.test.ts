import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleCodexHookEvent,
  renderCodexHookOutput,
} from "../../codex-hooks/src/hookAdapter.js";
import { inspectCodexLocalSetup } from "../../codex-hooks/src/localConfig.js";
import type { AssessmentResult } from "../../kernel/src/assessment.js";
import type { CoachEventEnvelope } from "../../kernel/src/protocol.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { thresholdEvent } from "../../mcp/src/__fixtures__/inputs.js";
import { invokeArchitectureTool } from "../../mcp/src/tools.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("Codex local support E2E", () => {
  maybeIt("configures local MCP, captures a baseline, and injects Codex follow-up guidance", () => {
    const repo = mkdtempSync(join(tmpdir(), "tech-lead-codex-local-e2e-"));
    try {
      mkdirSync(join(repo, "src"), { recursive: true });
      writeFileSync(join(repo, "package.json"), JSON.stringify({
        scripts: { test: "vitest run" },
        dependencies: { react: "^19.0.0" },
      }), "utf8");
      writeFileSync(
        join(repo, "src", "projectStorage.ts"),
        "export function saveProject(project: unknown) { localStorage.setItem('project', JSON.stringify(project)); }\n",
        "utf8",
      );

      const setup = inspectCodexLocalSetup({ techLeadRoot: process.cwd() });
      expect(setup.status).toBe("ready");
      expect(setup.configToml).toContain("bin/archcoach-mcp");
      expect(setup.configToml).not.toContain(".codex-plugin");
      expect(setup.configToml).not.toContain(".agents/plugins");
      const skillTemplate = readFileSync("packages/codex-hooks/templates/tech-coach/SKILL.md", "utf8");
      expect(skillTemplate).toContain("Pass that path explicitly as `repoRoot`");
      expect(skillTemplate).toContain("Never\ncall `architecture.capture_assessment` with `{}`");
      expect(skillTemplate).toContain("\"event\": {");
      expect(skillTemplate).toContain("Definition-first rule");
      expect(skillTemplate).toContain("Do not use acronym-only lists");

      const capture = invokeArchitectureTool("architecture.capture_assessment", {
        repoRoot: repo,
        event: {
          ...thresholdEvent,
          cwd: repo,
          host: "codex",
          userRequest: "Assess this existing app before I add sharing",
        },
      });
      expect(capture.ok).toBe(true);
      expect(existsSync(join(repo, ".ceetrix", "tech-lead", "latest-assessment.md"))).toBe(true);

      const response = handleCodexHookEvent(
        {
          hook_event_name: "UserPromptSubmit",
          cwd: repo,
          session_id: "codex-e2e",
          prompt: "how do I create a local-only version?",
        },
        { mode: "advisory" },
        {
          collectTelemetry: (event) => collectFixture(repo, event.kind),
          assess: quietAssessment,
        },
      );
      expect(response.effect).toBe("inject");
      expect(response.message).toContain("You already have useful project context for this question.");
      expect(renderCodexHookOutput("UserPromptSubmit", response)).toContain("architecture.query_assessment_graph");
      expect(existsSync(join(repo, ".codex-plugin"))).toBe(false);
      expect(existsSync(join(repo, ".agents", "plugins"))).toBe(false);

      const postToolResponse = handleCodexHookEvent({
        hook_event_name: "PostToolUse",
        cwd: repo,
        tool_name: "apply_patch",
        changed_files: ["src/projectStorage.ts"],
      });
      expect(postToolResponse.effect).toBe("none");
      expect(renderCodexHookOutput("PostToolUse", postToolResponse)).toBe("");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function collectFixture(repo: string, kind: string): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
} {
  return {
    event: {
      host: "codex",
      event: kind,
      cwd: repo,
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

function quietAssessment(): AssessmentResult {
  return {
    status: "ok",
    action: "Continue",
    reason: "Current evidence does not require adding structure yet.",
    intervention: "note",
    baseline: {
      repoRoot: "/repo",
      generatedAt: "2026-05-03T10:00:00.000Z",
      concerns: [],
      facts: [],
      unknowns: [],
      diagnostics: [],
    },
    evidence: [],
    questions: [],
    revisitAlerts: [],
    doNotAdd: [],
    memory: { status: "absent", decisionCount: 0 },
    principleGuidance: [],
    temporalBrief: { past: [], current: [], future: [], uncertain: [] },
  };
}
