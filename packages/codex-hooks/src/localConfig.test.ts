import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectCodexLocalSetup,
  renderCodexMcpConfig,
} from "./localConfig.js";

describe("Codex local configuration diagnostics", () => {
  it("renders a local MCP server config for this checkout", () => {
    const config = renderCodexMcpConfig({
      techLeadRoot: "/opt/tech-lead",
      mode: "balanced",
      startupTimeoutSec: 30,
      toolTimeoutSec: 90,
    });

    expect(config).toContain("[mcp_servers.tech-coach]");
    expect(config).toContain('command = "/opt/tech-lead/bin/archcoach-mcp"');
    expect(config).toContain('cwd = "/opt/tech-lead"');
    expect(config).toContain("startup_timeout_sec = 30");
    expect(config).toContain("tool_timeout_sec = 90");
    expect(config).toContain("[mcp_servers.tech-coach.env]");
    expect(config).toContain('ARCHCOACH_MODE = "balanced"');
    expect(config).not.toContain(".codex-plugin");
    expect(config).not.toContain(".agents/plugins");
  });

  it("reports ready when local launchers and runtimes are present", () => {
    const root = "/opt/tech-lead";
    const present = new Set([
      join(root, "bin", "archcoach-mcp"),
      join(root, "bin", "archcoach"),
      join(root, "mcp", "server", "index.ts"),
      join(root, "packages", "cli", "src", "index.ts"),
      join(root, "packages", "codex-hooks", "templates", "tech-coach", "SKILL.md"),
    ]);

    const setup = inspectCodexLocalSetup({
      techLeadRoot: root,
      fileExists: (path) => present.has(path),
    });

    expect(setup.status).toBe("ready");
    expect(setup.diagnostics).toEqual([
      expect.objectContaining({
        id: "codex-local-ready",
        severity: "info",
      }),
    ]);
  });

  it("reports missing local pieces and untrusted project config", () => {
    const setup = inspectCodexLocalSetup({
      techLeadRoot: "/opt/tech-lead",
      projectConfig: true,
      trustedProject: false,
      fileExists: () => false,
    });

    expect(setup.status).toBe("incomplete");
    expect(setup.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "codex-mcp-launcher-missing",
      "codex-cli-launcher-missing",
      "codex-mcp-runtime-missing",
      "codex-cli-runtime-missing",
      "codex-skill-template-missing",
      "codex-project-not-trusted",
    ]);
  });
});
