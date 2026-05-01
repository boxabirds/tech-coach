import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitLog } from "./gitHistory.js";
import {
  chooseInteractionGuidance,
  collectHistoryInteractionEvidence,
  collectHistoryInteractionEvidenceFromProject,
} from "./historyProviders.js";
import { redactTranscriptText } from "./transcripts.js";

describe("history interaction evidence", () => {
  it("derives technical choice guidance from compact history signals", () => {
    const result = collectHistoryInteractionEvidence({
      cwd: "/repo",
      transcripts: [
        { speaker: "user", text: "Refactor the API boundary and extract storage interfaces." },
        { speaker: "user", text: "Use SQL unless the schema makes that painful." },
      ],
      gitCommits: [
        { subject: "refactor storage repository", files: ["src/storage/projects.ts"] },
      ],
      ceetrixRecords: [
        { kind: "task", title: "Define API contract for storage adapter" },
      ],
    });

    expect(result.interactionGuidance).toMatchObject({
      languageComfort: "technical",
      questionStyle: "technical_choice",
    });
    expect(result.evidence[0]).toMatchObject({
      category: "history_interaction",
      status: "present",
      confidence: "high",
      interactionGuidance: result.interactionGuidance,
    });
  });

  it("derives business outcome and risk styles without exposing raw transcript text", () => {
    const outcome = collectHistoryInteractionEvidence({
      cwd: "/repo",
      transcripts: [
        {
          speaker: "user",
          text: "Customer workflow needs sharing and export for alice@example.com in /Users/alice/project.",
        },
      ],
      gitCommits: [],
      ceetrixRecords: [],
    });
    const serializedOutcome = JSON.stringify(outcome.evidence);

    expect(outcome.interactionGuidance).toMatchObject({
      languageComfort: "outcome_oriented",
      questionStyle: "business_outcome",
    });
    expect(serializedOutcome).not.toContain("alice@example.com");
    expect(serializedOutcome).not.toContain("/Users/alice/project");
    expect(serializedOutcome).not.toMatch(/\b(novice|expert|naive|sophisticated)\b/i);

    const risk = chooseInteractionGuidance({
      technical: 1,
      outcome: 0,
      risk: 3,
      repair: 0,
      direction: 0,
    });

    expect(risk).toMatchObject({
      languageComfort: "outcome_oriented",
      questionStyle: "risk_compliance",
    });
  });

  it("lets the current request override history-derived style", () => {
    const result = collectHistoryInteractionEvidence({
      cwd: "/repo",
      currentRequest: "We need GDPR deletion and retention controls.",
      transcripts: [
        { speaker: "user", text: "Refactor the API boundary and storage adapter." },
        { speaker: "user", text: "Use SQL and define the schema." },
      ],
      gitCommits: [],
      ceetrixRecords: [],
    });

    expect(result.interactionGuidance.questionStyle).toBe("risk_compliance");
    expect(result.interactionGuidance.rationale).toContain("Current request overrides history");
  });

  it("records missing history sources as non-blocking diagnostics", () => {
    const result = collectHistoryInteractionEvidence({ cwd: "/repo" });

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "history_interaction", status: "present" }),
        expect.objectContaining({ category: "diagnostic", status: "absent" }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "agent transcript history unavailable",
        "git history unavailable",
        "Ceetrix history unavailable",
      ]),
    );
  });

  it("redacts direct transcript text if a caller needs to echo a snippet", () => {
    expect(redactTranscriptText("Email bob@example.com in /Users/bob/workspace")).toBe(
      "Email [redacted-email] in [redacted-path]",
    );
  });

  it("parses git commit history into compact records", () => {
    const records = parseGitLog([
      "abc123\x1f2026-05-01T09:00:00+00:00\x1frefactor storage API",
      "src/storage/projects.ts",
      "src/api/projects.ts",
      "",
      "def456\x1f2026-05-01T08:00:00+00:00\x1ffix export workflow bug",
      "src/export.ts",
    ].join("\n"));

    expect(records).toEqual([
      {
        hash: "abc123",
        timestamp: "2026-05-01T09:00:00+00:00",
        subject: "refactor storage API",
        files: ["src/storage/projects.ts", "src/api/projects.ts"],
      },
      {
        hash: "def456",
        timestamp: "2026-05-01T08:00:00+00:00",
        subject: "fix export workflow bug",
        files: ["src/export.ts"],
      },
    ]);
  });

  it("loads transcript and Ceetrix history paths into project-level guidance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tech-coach-history-"));
    const transcriptPath = join(dir, "session.jsonl");
    const ceetrixPath = join(dir, "ceetrix.json");
    await writeFile(transcriptPath, [
      JSON.stringify({ role: "user", content: "Customer workflow needs sharing and export." }),
      JSON.stringify({ role: "assistant", content: "I can ask about storage outcomes." }),
      JSON.stringify({ role: "user", content: "Also preserve privacy deletion obligations." }),
    ].join("\n"));
    await writeFile(ceetrixPath, JSON.stringify({
      records: [
        {
          kind: "decision",
          title: "Storage capability",
          body: "Design should preserve user deletion workflow and privacy audit evidence.",
        },
      ],
    }));

    const result = await collectHistoryInteractionEvidenceFromProject({
      cwd: dir,
      transcriptPaths: [transcriptPath],
      ceetrixHistoryPaths: [ceetrixPath],
      gitCommits: [
        {
          subject: "fix storage bug in export workflow",
          files: ["src/storage/projects.ts", "src/export.ts"],
        },
      ],
    });

    expect(result.interactionGuidance.questionStyle).toBe("business_outcome");
    expect(result.evidence[0]?.evidence).toEqual(
      expect.arrayContaining([
        "agent transcript user turns: 2",
        "git commits analyzed: 1",
        "Ceetrix records analyzed: 1",
      ]),
    );
  });
});
