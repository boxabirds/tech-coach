import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Codex Tech Coach skill template", () => {
  it("requires the active repository path for Tech Coach assessment calls", () => {
    const skill = readFileSync("packages/codex-hooks/templates/tech-coach/SKILL.md", "utf8");

    expect(skill).toContain("Pass that path explicitly as `repoRoot`");
    expect(skill).toContain("Never\ncall `architecture.capture_assessment` with `{}`");
    expect(skill).toContain("\"repoRoot\": \"<active project path>\"");
    expect(skill).toContain("The capture command expects an outer `event` object");
    expect(skill).toContain("Definition-first rule");
    expect(skill).toContain("This applies to every domain");
    expect(skill).toContain("define it in the same sentence");
    expect(skill).toContain("Do not use acronym-only lists");
  });
});
