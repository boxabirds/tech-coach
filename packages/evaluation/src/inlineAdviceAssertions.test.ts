import { describe, expect, it } from "vitest";
import { assertInlineAdviceResponse } from "./inlineAdviceAssertions.js";

const localOnlyPrompt = "how do I create a local-only version of Ceetrix?";

describe("inline Tech Lead advice assertions", () => {
  it("passes grounded recommendation-first local-only advice", () => {
    const failures = assertInlineAdviceResponse({
      prompt: localOnlyPrompt,
      expectedEvidenceAreas: ["storage", "deployment", "auth", "boundary"],
      response: [
        "Using Tech Lead baseline context, the best path is to treat local-only as a local runtime profile rather than a fork.",
        "The storage, deployment, auth, and boundary evidence point to preserving the existing contracts while swapping hosted dependencies for local equivalents.",
        "Start by proving core workflows through the same persistence and API boundaries.",
        "Two questions could change the plan: does local-only mean fully offline, or just no hosted Ceetrix dependency? Is the target single-user local use or on-prem multi-user use?",
      ].join("\n\n"),
    });

    expect(failures).toEqual([]);
  });

  it("fails the broad interview-first local-only response", () => {
    const failures = assertInlineAdviceResponse({
      prompt: localOnlyPrompt,
      expectedEvidenceAreas: ["storage", "deployment", "auth", "boundary"],
      response: [
        "Before I can advise on the architecture, I need to understand the scope.",
        "What does local-only mean?",
        "Is it offline-first, self-hosted, hybrid, or development/testing?",
        "What's the trigger?",
        "What data and features matter?",
      ].join("\n\n"),
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_provenance" }),
        expect.objectContaining({ kind: "missing_grounded_recommendation" }),
        expect.objectContaining({ kind: "interview_first" }),
        expect.objectContaining({ kind: "too_many_questions" }),
        expect.objectContaining({ kind: "current_state_question" }),
      ]),
    );
  });

  it("fails exposed raw ids even when the advice is otherwise grounded", () => {
    const failures = assertInlineAdviceResponse({
      prompt: localOnlyPrompt,
      expectedEvidenceAreas: ["storage"],
      response: [
        "Using Tech Lead baseline context, the default recommendation is to preserve the storage boundary.",
        "Evidence claim-authentication-claim-authentication-web-user-authentication-0 confirms storage.",
      ].join("\n"),
    });

    expect(failures).toContainEqual(
      expect.objectContaining({ kind: "raw_id_exposed" }),
    );
  });
});
