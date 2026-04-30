import { describe, expect, it } from "vitest";
import { normalizeHostEvent } from "./normalize.js";
import { ProtocolValidationError } from "./protocol.js";

describe("normalizeHostEvent", () => {
  it("normalizes a valid generic host event", () => {
    const result = normalizeHostEvent({
      host: "generic",
      event: "post_change",
      cwd: "/repo",
      userRequest: "Add saved projects",
      recentRequests: ["Create editor"],
      changedFiles: ["src/editor.ts"],
      repoSignals: { status: "present", packages: ["web"] },
      testSummary: { status: "not_run" },
      memoryRefs: ["decision-1"],
      priorDecisions: [{ id: "decision-1", concern: "persistence" }],
      optionalSignals: [{ source: "git", status: "present" }],
    });

    expect(result).toEqual({
      host: "generic",
      event: "post_change",
      cwd: "/repo",
      userRequest: "Add saved projects",
      recentRequests: ["Create editor"],
      changedFiles: ["src/editor.ts"],
      repoSignals: { status: "present", packages: ["web"] },
      testSummary: { status: "not_run" },
      memoryRefs: ["decision-1"],
      priorDecisions: [{ id: "decision-1", concern: "persistence" }],
      optionalSignals: [{ source: "git", status: "present" }],
    });
  });

  it("normalizes equivalent Claude-style aliases into the same envelope shape", () => {
    const generic = normalizeHostEvent({
      host: "claude-code",
      event: "UserPromptSubmit",
      cwd: "/repo",
      user_request: "Share projects",
      recent_requests: ["Save projects"],
      changed_files: ["src/projects.ts"],
      memory_refs: ["decision-local-storage"],
      prior_decisions: [{ id: "decision-local-storage" }],
      optional_signals: [{ source: "lsp", status: "absent" }],
    });

    const claude = normalizeHostEvent({
      host: "claude-code",
      kind: "UserPromptSubmit",
      workingDirectory: "/repo",
      payload: { prompt: "Share projects" },
      recentRequests: ["Save projects"],
      changedFiles: ["src/projects.ts"],
      memoryRefs: ["decision-local-storage"],
      priorDecisions: [{ id: "decision-local-storage" }],
      optionalSignals: [{ source: "lsp", status: "absent" }],
    });

    expect(claude).toEqual(generic);
  });

  it("defaults absent optional collections without blocking assessment", () => {
    expect(
      normalizeHostEvent({
        host: "generic",
        event: "request",
        cwd: "/repo",
      }),
    ).toEqual({
      host: "generic",
      event: "request",
      cwd: "/repo",
      recentRequests: [],
      changedFiles: [],
      repoSignals: { status: "absent" },
      memoryRefs: [],
      priorDecisions: [],
      optionalSignals: [],
    });
  });

  it("reports missing required fields", () => {
    expect(() => normalizeHostEvent({ host: "generic" })).toThrow(
      ProtocolValidationError,
    );

    try {
      normalizeHostEvent({ host: "generic" });
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect((error as ProtocolValidationError).issues).toEqual([
        { field: "event", message: "is required" },
        { field: "cwd", message: "is required" },
      ]);
    }
  });

  it("reports malformed changed-file values", () => {
    expect(() =>
      normalizeHostEvent({
        host: "generic",
        event: "post_change",
        cwd: "/repo",
        changedFiles: ["src/a.ts", 42],
      }),
    ).toThrow(/changedFiles\[1\]/);
  });

  it("reports malformed memory and optional signal collections", () => {
    const action = () =>
      normalizeHostEvent({
        host: "generic",
        event: "post_change",
        cwd: "/repo",
        memoryRefs: [1],
        priorDecisions: ["bad"],
        optionalSignals: ["bad"],
      });

    expect(action).toThrow(ProtocolValidationError);

    try {
      action();
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect((error as ProtocolValidationError).issues).toEqual([
        { field: "memoryRefs[0]", message: "must be a string" },
        { field: "priorDecisions[0]", message: "must be an object" },
        { field: "optionalSignals[0]", message: "must be an object" },
      ]);
    }
  });

  it("reports malformed repository and test fields", () => {
    const action = () =>
      normalizeHostEvent({
        host: "generic",
        event: "post_change",
        cwd: "/repo",
        repoSignals: { status: "fresh" },
        testSummary: "passed",
      });

    expect(action).toThrow(ProtocolValidationError);

    try {
      action();
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect((error as ProtocolValidationError).issues).toEqual([
        {
          field: "repoSignals.status",
          message: "must be present, absent, or failed",
        },
        { field: "testSummary", message: "must be an object" },
      ]);
    }
  });
});
