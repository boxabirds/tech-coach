import { describe, expect, it } from "vitest";
import {
  buildUsageReview,
  classifyUsageEvent,
  normalizeUsageEvent,
  sanitizeUsageMetadata,
} from "./usageEvents.js";

describe("usage event logging", () => {
  it("classifies hook, MCP, evaluation, and missed-engagement events", () => {
    expect(classifyUsageEvent({
      source: "hook",
      hookEffect: "inject",
      architectureRelevant: true,
      baselineExists: true,
    })).toMatchObject({
      engagementType: "followup_injection",
      outcome: "engaged",
    });
    expect(classifyUsageEvent({
      source: "hook",
      hookEffect: "none",
      architectureRelevant: true,
      baselineExists: true,
    })).toMatchObject({
      engagementType: "passive_silence",
      outcome: "quiet",
      metadata: { missedEngagementCandidate: true },
    });
    expect(classifyUsageEvent({
      source: "mcp",
      toolName: "architecture.capture_assessment",
    })).toMatchObject({
      engagementType: "baseline_capture",
      outcome: "engaged",
    });
    expect(classifyUsageEvent({
      source: "mcp",
      toolName: "architecture.query_assessment_graph",
    })).toMatchObject({
      engagementType: "graph_query",
      outcome: "engaged",
    });
    expect(classifyUsageEvent({
      source: "evaluation",
      responseFailed: true,
    })).toMatchObject({
      engagementType: "response_evaluation",
      outcome: "failed",
    });
  });

  it("redacts prompts, source snippets, and secret-looking values by default", () => {
    const sanitized = sanitizeUsageMetadata({
      prompt: "how do I add local-only storage?",
      toolName: "architecture.capture_assessment",
      code: "export function token() { return process.env.API_KEY; }",
      apiKey: "sk-test-secret-value-123456789",
      count: 3,
      architectureRelevant: true,
    });

    expect(JSON.stringify(sanitized)).not.toContain("local-only storage");
    expect(JSON.stringify(sanitized)).not.toContain("process.env");
    expect(JSON.stringify(sanitized)).not.toContain("sk-test");
    expect(sanitized).toMatchObject({
      toolName: "architecture.capture_assessment",
      count: 3,
      architectureRelevant: true,
      redacted: true,
    });
  });

  it("builds paged usage reviews with repository grouping and notable gaps", () => {
    const events = [
      normalizeUsageEvent({
        id: "event-a",
        occurredAt: "2026-05-02T10:00:00.000Z",
        repoRoot: "/repo/a",
        repoId: "/repo/a",
        sessionId: "session-a",
        source: "hook",
        engagementType: "followup_injection",
        outcome: "engaged",
      }),
      normalizeUsageEvent({
        id: "event-b",
        occurredAt: "2026-05-02T10:01:00.000Z",
        repoRoot: "/repo/a",
        repoId: "/repo/a",
        sessionId: "session-a",
        source: "hook",
        engagementType: "passive_silence",
        outcome: "quiet",
        metadata: { missedEngagementCandidate: true },
      }),
      normalizeUsageEvent({
        id: "event-c",
        occurredAt: "2026-05-02T10:02:00.000Z",
        repoRoot: "/repo/b",
        repoId: "/repo/b",
        sessionId: "session-b",
        source: "mcp",
        engagementType: "graph_query",
        outcome: "engaged",
      }),
    ];

    const firstPage = buildUsageReview(events, { limit: 2 });
    const secondPage = buildUsageReview(events, { cursor: firstPage.page.nextCursor, limit: 2 });

    expect(firstPage.summary).toMatchObject({
      totalEvents: 3,
      byRepository: { "/repo/a": 2, "/repo/b": 1 },
      byEngagementType: {
        baseline_capture: 0,
        graph_query: 1,
        followup_injection: 1,
        passive_silence: 1,
        response_evaluation: 0,
        error: 0,
        user_visible_advice: 0,
      },
    });
    expect(firstPage.events.map((event) => event.id)).toEqual(["event-a", "event-b"]);
    expect(firstPage.notableGaps.map((event) => event.id)).toEqual(["event-b"]);
    expect(secondPage.events.map((event) => event.id)).toEqual(["event-c"]);
  });
});
