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
                summary: "Package or workspace boundaries are visible. Evidence: Runtime boundary candidates: React/TypeScript frontend and Rust/WASM or native-module markers are both present.",
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

    expect(markdown.indexOf("## What The Repo Looks Like")).toBeLessThan(
      markdown.indexOf("## Next Actions"),
    );
    expect(markdown).toContain("This report explains what Tech Lead noticed and what it means for the next change.");
    expect(markdown).toContain("Technical detail: the durable source of truth is the local database recorded below");
    expect(markdown).toContain("Store: /repo/.ceetrix/tech-lead/tech-lead.db");
    expect(markdown).toContain("Technical detail: package_boundary, confidence medium.");
    expect(markdown).toContain("React/TypeScript frontend and Rust/WASM or native-module markers are both present");
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

  it("renders only selected guidance in next actions", () => {
    const markdown = renderLatestAssessment({
      run: {
        runId: "run-selected-guidance",
        repoRoot: "/repo",
        capturedAt: "2026-05-01T12:00:00.000Z",
        lifecycleState: "captured",
        durableRecordCreated: true,
        diagnostics: [],
        input: {},
        assessment: {
          status: "needs_attention",
          intervention: "recommend",
          action: "Run review",
          reason: "Current evidence shows broad change pressure.",
          evidence: [],
          doNotAdd: [],
          memory: { status: "absent", decisionCount: 0 },
          questions: [],
          revisitAlerts: [],
          policy: {
            concerns: [],
            selected: {
              concern: "risk_hotspot",
              action: "Run review",
              intervention: "recommend",
              reason: "Current evidence shows broad change pressure.",
              thresholdCandidates: ["blast_radius"],
              axes: {
                complexity: "medium",
                irreversibility: "medium",
                solutionVisibility: "medium",
                planningHorizon: "medium",
              },
              principleIds: [],
              doNotAdd: [],
              provisional: false,
              requiresQuestion: false,
            },
          },
          principleGuidance: [{
            concern: "package_boundary",
            principles: [],
            patterns: [{
              pattern: "add_targeted_test_harness",
              concern: "package_boundary",
              principleIds: [],
              addNow: "Add a small integration test around the React/TypeScript to Rust/WASM boundary before changing behavior across it.",
              doNotAddYet: "Do not split packages further.",
              evidence: [],
              missingEvidence: [],
              confidence: "medium",
            }],
          }],
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
      openQuestions: [],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    } satisfies LatestAssessmentPack);

    expect(markdown).toContain("- Run review: Current evidence shows broad change pressure.");
    expect(markdown).not.toContain("React/TypeScript to Rust/WASM boundary");
  });

  it("renders temporal evidence before recommendations", () => {
    const markdown = renderLatestAssessment({
      run: {
        runId: "run-temporal",
        repoRoot: "/repo",
        capturedAt: "2026-05-01T12:00:00.000Z",
        lifecycleState: "captured",
        durableRecordCreated: true,
        diagnostics: [],
        input: {},
        assessment: {
          status: "needs_attention",
          intervention: "recommend",
          action: "Continue",
          reason: "Future-facing architecture evidence is available; use it as the planning anchor and current code as the feasibility check.",
          evidence: [{
            family: "repository",
            source: "documentation",
            category: "architecture_claim",
            timeframe: "future",
            role: "architecture_basis",
            summary: "docs/design/tech-architecture.md: Bounded documentation describes architecture.",
          }],
          temporalBrief: {
            future: ["docs/design/tech-architecture.md: Bounded documentation describes architecture."],
            current: ["src/main.ts: Inventory includes src/main.ts"],
            past: ["pocs/old-lab/package.json: Inventory includes pocs/old-lab/package.json"],
            uncertain: [],
          },
          doNotAdd: ["Do not treat old experiments or dirty status as active project direction unless user intent or project documents point to them."],
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
      openQuestions: [],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    } satisfies LatestAssessmentPack);

    expect(markdown.indexOf("## Time Basis")).toBeLessThan(markdown.indexOf("## Next Actions"));
    expect(markdown).toContain("- Future intent: docs/design/tech-architecture.md");
    expect(markdown).toContain("- Current system: src/main.ts");
    expect(markdown).toContain("- Past context: pocs/old-lab/package.json");
    expect(markdown).toContain("(future, architecture_basis)");
  });

  it("leads claim text with plain English before technical labels", () => {
    const markdown = renderLatestAssessment({
      run: {
        runId: "run-claims",
        repoRoot: "/repo",
        capturedAt: "2026-05-01T12:00:00.000Z",
        lifecycleState: "captured",
        durableRecordCreated: true,
        diagnostics: [],
        input: {},
        assessment: {
          status: "needs_attention",
          intervention: "recommend",
          action: "Record decision",
          reason: "Authentication has an unresolved assumption.",
          evidence: [{
            family: "repository",
            source: "auth-scan",
            category: "architecture_claim",
            summary: "The app has login but no clear admin role evidence.",
          }],
          doNotAdd: [],
          memory: { status: "absent", decisionCount: 0 },
          questions: [],
          revisitAlerts: [],
          principleGuidance: [],
          claims: [{
            id: "claim-auth",
            concern: "authorization",
            subject: "Admin permissions",
            claim: "The app has login behavior, but admin permissions are not clearly evidenced.",
            confidence: "medium",
            evidenceNodeIds: [],
            evidence: ["Login code is present", "No admin role evidence was found"],
            counterEvidence: [],
            residualUnknowns: ["Which permission change should guide the next review"],
          }],
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
      openQuestions: [],
      answeredQuestions: [],
      skippedQuestions: [],
      decisions: [],
      storePath: "/repo/.ceetrix/tech-lead/tech-lead.db",
    } satisfies LatestAssessmentPack);

    const plainIndex = markdown.indexOf("- The app has login behavior");
    const technicalIndex = markdown.indexOf("Technical detail: authorization");
    expect(markdown).toContain("## What Tech Lead Thinks Matters");
    expect(plainIndex).toBeGreaterThan(-1);
    expect(technicalIndex).toBeGreaterThan(plainIndex);
    expect(markdown).toContain("Supporting evidence: Login code is present");
    expect(markdown).toContain("Still unclear: Which permission change should guide the next review");
  });
});
