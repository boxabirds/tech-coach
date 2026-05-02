import { describe, expect, it } from "vitest";
import { renderLatestAssessment } from "./artifacts.js";
import type { LatestAssessmentPack } from "./types.js";

describe("assessment artifact language", () => {
  it("renders observed architecture shape before next actions", () => {
    const markdown = renderLatestAssessment({
      run: {
        runId: "run-shape",
        repoRoot: "/repo",
        capturedAt: "2026-05-01T12:00:00.000Z",
        lifecycleState: "captured",
        durableRecordCreated: true,
        diagnostics: [],
        telemetry: {
          lifecycle: [],
          repository: [],
          change: [],
          test: [],
          memory: [],
          runtime: [],
          diagnostics: [],
        },
        input: {},
        assessment: {
          status: "needs_attention",
          intervention: "recommend",
          action: "Add test harness",
          reason: "Repository shape shows a runtime or package boundary.",
          evidence: [],
          doNotAdd: [],
          memory: { status: "absent", decisionCount: 0 },
          questions: [],
          revisitAlerts: [],
          principleGuidance: [],
          baseline: {
            repoRoot: "/repo",
            generatedAt: "2026-05-01T12:00:00.000Z",
            diagnostics: [],
            unknowns: [],
            concerns: [],
            facts: [
              {
                id: "fact-package-boundary",
                concern: "package_boundary",
                label: "Package or workspace boundaries are visible",
                status: "observed",
                confidence: "medium",
                freshness: "current",
                sources: [{
                  source: "repository-shape",
                  category: "architecture_shape",
                  status: "present",
                  freshness: "current",
                  confidence: "high",
                }],
                summary: "Package or workspace boundaries are visible. Evidence: Runtime boundary: React/TypeScript UI depends on Rust/WASM or native-module code.",
              },
            ],
          },
        },
      },
      openQuestions: [],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    } satisfies LatestAssessmentPack);

    expect(markdown.indexOf("## Observed Architecture Shape")).toBeLessThan(
      markdown.indexOf("## Next Actions"),
    );
    expect(markdown).toContain("Generated report from the repo-local Ceetrix Tech Lead SQLite store.");
    expect(markdown).toContain("The durable source of truth is the database recorded below");
    expect(markdown).toContain("Store: /repo/.ceetrix/tech-lead/tech-lead.db");
    expect(markdown).toContain("package_boundary (medium)");
    expect(markdown).toContain("React/TypeScript UI depends on Rust/WASM");
    expect(markdown).toContain("- Add test harness: Repository shape shows a runtime or package boundary.");
  });

  it("keeps raw question ids out of list labels while preserving machine handles", () => {
    const markdown = renderLatestAssessment({
      run: {
        runId: "run-questions",
        repoRoot: "/repo",
        capturedAt: "2026-05-01T12:00:00.000Z",
        lifecycleState: "interview_open",
        durableRecordCreated: true,
        diagnostics: [],
        input: {},
        assessment: {
          status: "needs_attention",
          intervention: "recommend",
          action: "Record decision",
          reason: "Authentication has an unresolved assumption.",
          evidence: [],
          doNotAdd: [],
          memory: { status: "absent", decisionCount: 0 },
          questions: [],
          revisitAlerts: [],
          principleGuidance: [],
          baseline: {
            repoRoot: "/repo",
            generatedAt: "2026-05-01T12:00:00.000Z",
            diagnostics: [],
            unknowns: [],
            concerns: [],
            facts: [],
          },
        },
      },
      openQuestions: [{
        id: "question-claim-authentication-claim-authentication-web-user-authentication-0",
        concern: "authentication",
        kind: "choose",
        prompt: "Which security review should authentication evidence guide next?",
        reason: "Repository evidence answers the current shape; this asks which future risk should drive the next architecture move.",
        relatedFactIds: [],
        relatedUnknownIds: [],
        relatedSignalIds: [],
      }],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    } satisfies LatestAssessmentPack);

    expect(markdown).toContain("- Which security review should authentication evidence guide next?");
    expect(markdown).toContain("Question id: question-claim-authentication-claim-authentication-web-user-authentication-0");
    expect(markdown).not.toContain("- question-claim-authentication-claim-authentication-web-user-authentication-0:");
  });
});
