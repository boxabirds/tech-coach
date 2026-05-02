import { describe, expect, it } from "vitest";
import { assertAgentBehavior } from "./agentBehavior.js";

describe("agent behavior action vocabulary", () => {
  it("passes when agent operations match right-sized coach actions", () => {
    expect(assertAgentBehavior({
      action: "Name",
      operations: [{ kind: "create_name", summary: "Name shared filter state ownership" }],
    })).toEqual([]);

    expect(assertAgentBehavior({
      action: "Insert boundary",
      operations: [{ kind: "extract_boundary", summary: "Extract project storage repository boundary" }],
    })).toEqual([]);

    expect(assertAgentBehavior({
      action: "Continue",
      operations: [{ kind: "local_edit", summary: "Rename local heading copy" }],
    })).toEqual([]);
  });

  it("fails when the agent overbuilds after do-not-add guidance", () => {
    const mismatches = assertAgentBehavior({
      action: "Continue",
      operations: [
        { kind: "local_edit", summary: "Rename button copy" },
        { kind: "extract_boundary", summary: "Add repository boundary anyway" },
      ],
    });

    expect(mismatches).toContainEqual(
      expect.objectContaining({
        kind: "forbidden_operation",
        actual: "extract_boundary",
      }),
    );
  });

  it("fails when the agent jumps from boundary advice to substrate replacement", () => {
    const mismatches = assertAgentBehavior({
      action: "Insert boundary",
      operations: [
        { kind: "extract_boundary", summary: "Add storage adapter" },
        { kind: "replace_substrate", summary: "Replace localStorage with Postgres" },
      ],
    });

    expect(mismatches).toContainEqual(
      expect.objectContaining({
        kind: "forbidden_operation",
        actual: "replace_substrate",
      }),
    );
  });

  it("requires host-mediated questions and durable decision records for decision actions", () => {
    expect(assertAgentBehavior({
      action: "Stop and decide",
      operations: [],
      questionsAsked: 0,
    })).toContainEqual(
      expect.objectContaining({ kind: "missing_user_question" }),
    );

    expect(assertAgentBehavior({
      action: "Record decision",
      operations: [{ kind: "ask_user", summary: "Ask user for storage preference" }],
      decisionsRecorded: 0,
    })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_required_operation" }),
        expect.objectContaining({ kind: "missing_decision_record" }),
      ]),
    );
  });

  it("flags unrelated architecture regardless of nominal action", () => {
    const mismatches = assertAgentBehavior({
      action: "Run review",
      operations: [
        { kind: "run_review", summary: "Review auth boundary" },
        { kind: "add_unrelated_architecture", summary: "Add event sourcing framework" },
      ],
    });

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "forbidden_operation" }),
        expect.objectContaining({ kind: "unrelated_architecture" }),
      ]),
    );
  });
});
