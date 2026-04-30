import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DecisionRecordValidationError,
  ProjectMemoryStore,
  assertDecisionRecord,
  decisionRecordsToMemorySignals,
  readDecisionMemory,
  validateDecisionRecord,
  withMemorySignals,
} from "./memory.js";
import {
  authShortcutDecision,
  invalidDecision,
  localStorageDecision,
  revisitEvent,
} from "./__fixtures__/memory/scenarios.js";

describe("decision memory validation", () => {
  it("accepts complete decision records with revisit conditions", () => {
    expect(validateDecisionRecord(localStorageDecision)).toEqual([]);
    expect(assertDecisionRecord(localStorageDecision)).toEqual(localStorageDecision);
  });

  it("returns precise issues for malformed records", () => {
    expect(validateDecisionRecord(invalidDecision)).toEqual(
      expect.arrayContaining([
        { field: "record.id", message: "must be a non-empty string" },
        { field: "record.reason", message: "must be a non-empty string" },
        { field: "record.risks", message: "must be a non-empty array of strings" },
        { field: "record.revisitIf", message: "must be a non-empty array of strings" },
        { field: "record.state", message: "must be a valid maturity state" },
        { field: "record.source", message: "must be user, coach, or agent" },
      ]),
    );
  });

  it("shapes decision records as high-confidence memory telemetry", () => {
    const [signal] = decisionRecordsToMemorySignals([localStorageDecision], {
      capturedAt: "2026-04-30T13:00:00.000Z",
      correlationId: "turn-memory",
    });

    expect(signal).toMatchObject({
      id: "memory-decision-localstorage-projects",
      family: "memory",
      source: "decision-localstorage-projects",
      capturedAt: "2026-04-30T13:00:00.000Z",
      confidence: "high",
      correlationId: "turn-memory",
      payload: {
        id: "decision-localstorage-projects",
        reason: localStorageDecision.reason,
        risks: localStorageDecision.risks,
        state: "Exploratory",
        revisitIf: ["sharing", "sync", "user accounts"],
        evidence: expect.arrayContaining([
          "revisit_if: sharing, sync, user accounts",
        ]),
      },
    });
  });

  it("adds memory summaries to existing event context without replacing current signals", () => {
    const event = withMemorySignals(revisitEvent, [localStorageDecision]);

    expect(event.memoryRefs).toContain("decision-localstorage-projects");
    expect(event.priorDecisions).toContainEqual({
      id: "decision-localstorage-projects",
      concern: "project persistence",
      decision: "Use localStorage while saved projects are single-user only",
      revisitIf: ["sharing", "sync", "user accounts"],
    });
    expect(event.changedFiles).toEqual(revisitEvent.changedFiles);
  });
});

describe("ProjectMemoryStore", () => {
  it("saves and reads JSONL records from .archcoach memory", () => {
    const root = tempRoot();
    try {
      const store = new ProjectMemoryStore(root);

      store.append(localStorageDecision);
      store.append(authShortcutDecision);

      expect(store.list()).toEqual([localStorageDecision, authShortcutDecision]);
      expect(readFileSync(join(root, ".archcoach", "memory.jsonl"), "utf8")).toContain(
        "decision-localstorage-projects",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("distinguishes absent memory from corrupt memory", () => {
    const root = tempRoot();
    try {
      const store = new ProjectMemoryStore(root);
      expect(store.read()).toEqual({
        records: [],
        diagnostics: [
          expect.objectContaining({
            id: "memory-absent",
            severity: "info",
          }),
        ],
      });

      mkdirSync(join(root, ".archcoach"), { recursive: true });
      writeFileSync(store.memoryPath, "{not json", { encoding: "utf8" });
      expect(store.read()).toEqual({
        records: [],
        diagnostics: [
          expect.objectContaining({
            id: "memory-line-1-invalid-json",
            severity: "error",
          }),
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate decision IDs", () => {
    const root = tempRoot();
    try {
      const store = new ProjectMemoryStore(root);
      store.append(localStorageDecision);

      expect(() => store.append(localStorageDecision)).toThrow(
        DecisionRecordValidationError,
      );
      expect(store.read().diagnostics).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports invalid records without silently discarding memory problems", () => {
    const root = tempRoot();
    try {
      const store = new ProjectMemoryStore(root);
      mkdirSync(join(root, ".archcoach"), { recursive: true });
      writeFileSync(store.memoryPath, `${JSON.stringify(invalidDecision)}\n`, {
        encoding: "utf8",
      });

      expect(store.read()).toMatchObject({
        records: [],
        diagnostics: [
          {
            id: "memory-line-1-invalid-record",
            severity: "error",
            source: store.memoryPath,
          },
        ],
      });
      expect(() => store.list()).toThrow(DecisionRecordValidationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tech-coach-memory-"));
}
