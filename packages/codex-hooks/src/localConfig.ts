import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type CodexLocalConfigInput = {
  techLeadRoot: string;
  serverName?: string;
  mode?: "advisory" | "balanced" | "strict";
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabled?: boolean;
};

export type CodexSetupDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodexLocalSetupStatus = {
  status: "ready" | "incomplete";
  configToml: string;
  diagnostics: CodexSetupDiagnostic[];
};

export type CodexLocalSetupInput = CodexLocalConfigInput & {
  projectConfig?: boolean;
  trustedProject?: boolean;
  fileExists?: (path: string) => boolean;
};

export function renderCodexMcpConfig(input: CodexLocalConfigInput): string {
  const root = resolve(input.techLeadRoot);
  const serverName = input.serverName ?? "tech-coach";
  const mode = input.mode ?? "advisory";
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${tomlString(join(root, "bin", "archcoach-mcp"))}`,
    `cwd = ${tomlString(root)}`,
    `startup_timeout_sec = ${input.startupTimeoutSec ?? 20}`,
    `tool_timeout_sec = ${input.toolTimeoutSec ?? 60}`,
    `enabled = ${input.enabled === false ? "false" : "true"}`,
    "",
    `[mcp_servers.${serverName}.env]`,
    `ARCHCOACH_MODE = ${tomlString(mode)}`,
    "",
  ].join("\n");
}

export function inspectCodexLocalSetup(input: CodexLocalSetupInput): CodexLocalSetupStatus {
  const root = resolve(input.techLeadRoot);
  const fileExists = input.fileExists ?? existsSync;
  const diagnostics: CodexSetupDiagnostic[] = [];
  const mcpLauncher = join(root, "bin", "archcoach-mcp");
  const cliLauncher = join(root, "bin", "archcoach");
  const mcpSource = join(root, "mcp", "server", "index.ts");
  const mcpArtifact = join(root, "dist", "mcp-server.js");
  const cliSource = join(root, "packages", "cli", "src", "index.ts");
  const cliArtifact = join(root, "dist", "cli.js");
  const skillTemplate = join(root, "packages", "codex-hooks", "templates", "tech-coach", "SKILL.md");

  if (!fileExists(mcpLauncher)) {
    diagnostics.push({
      id: "codex-mcp-launcher-missing",
      severity: "error",
      message: `Missing local MCP launcher: ${mcpLauncher}`,
    });
  }
  if (!fileExists(cliLauncher)) {
    diagnostics.push({
      id: "codex-cli-launcher-missing",
      severity: "error",
      message: `Missing local CLI fallback: ${cliLauncher}`,
    });
  }
  if (!fileExists(mcpSource) && !fileExists(mcpArtifact)) {
    diagnostics.push({
      id: "codex-mcp-runtime-missing",
      severity: "error",
      message: "Missing local MCP runtime. Install bun for source execution or build dist/mcp-server.js.",
    });
  }
  if (!fileExists(cliSource) && !fileExists(cliArtifact)) {
    diagnostics.push({
      id: "codex-cli-runtime-missing",
      severity: "error",
      message: "Missing local CLI runtime. Install bun for source execution or build dist/cli.js.",
    });
  }
  if (!fileExists(skillTemplate)) {
    diagnostics.push({
      id: "codex-skill-template-missing",
      severity: "error",
      message: `Missing source-controlled Codex skill template: ${skillTemplate}`,
    });
  }
  if (input.projectConfig && input.trustedProject === false) {
    diagnostics.push({
      id: "codex-project-not-trusted",
      severity: "error",
      message: "Project-scoped .codex/config.toml requires a trusted Codex project.",
    });
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      id: "codex-local-ready",
      severity: "info",
      message: "Local Codex configuration can reach Tech Lead through the MCP launcher.",
    });
  }

  return {
    status: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "incomplete" : "ready",
    configToml: renderCodexMcpConfig(input),
    diagnostics,
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
