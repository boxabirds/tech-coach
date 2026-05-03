import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { thresholdEvent, decisionToRecord } from "../../mcp/src/__fixtures__/inputs.js";
import {
  applyPersistedAnswer,
  captureAssessment,
  confirmPersistedDecision,
} from "./capture.js";
import { TechLeadPersistenceStore } from "./store.js";

const maybeIt = process.versions.bun ? it : it.skip;

describe("repo-local persistence integration", () => {
  maybeIt("captures a brownfield assessment into SQLite and a durable artifact pack", () => {
    const repo = tempRepo();
    try {
      const result = captureAssessment({
        repoRoot: repo,
        event: { ...thresholdEvent, cwd: repo },
        now: "2026-05-01T10:00:00.000Z",
      });

      expect(result.durableRecordCreated).toBe(true);
      expect(result.storePath).toBe(join(repo, ".ceetrix", "tech-lead", "tech-lead.db"));
      expect(existsSync(result.storePath)).toBe(true);
      expect(statSync(result.storePath).size).toBeGreaterThan(0);
      expect(result.artifactPaths).toBeDefined();
      expect(readFileSync(result.artifactPaths!.latestAssessmentMd, "utf8")).toContain(
        "Tech Lead Assessment",
      );
      expect(JSON.parse(readFileSync(result.artifactPaths!.questionsJson, "utf8"))).toMatchObject({
        runId: result.runId,
        answerContract: {
          mcp: "architecture.answer_question",
        },
      });

      const store = new TechLeadPersistenceStore(repo);
      expect(store.latestRun()?.runId).toBe(result.runId);
      expect(store.listRuns()).toHaveLength(1);
      store.close();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("persists answers and confirmed decisions, then reuses them on a rerun", () => {
    const repo = tempRepo();
    try {
      const first = captureAssessment({
        repoRoot: repo,
        event: { ...thresholdEvent, cwd: repo },
        now: "2026-05-01T10:05:00.000Z",
      });
      expect(first.openQuestions.length).toBeGreaterThan(0);

      const question = first.openQuestions[0];
      const answered = applyPersistedAnswer({
        repoRoot: repo,
        questionId: question.id,
        action: "confirm",
        value: "This repository will be shared with a small private team.",
        now: "2026-05-01T10:06:00.000Z",
      });
      expect(answered.answeredQuestions).toContainEqual(
        expect.objectContaining({ questionId: question.id, status: "answered" }),
      );

      const decided = confirmPersistedDecision({
        repoRoot: repo,
        confirmed: true,
        decision: {
          ...decisionToRecord,
          id: "decision-persistence-integration",
          createdAt: "2026-05-01T10:07:00.000Z",
        },
        now: "2026-05-01T10:07:00.000Z",
      });
      expect(decided.decisions).toContainEqual(
        expect.objectContaining({ id: "decision-persistence-integration" }),
      );

      const rerun = captureAssessment({
        repoRoot: repo,
        event: { ...thresholdEvent, cwd: repo, userRequest: "Reassess after answering brownfield questions" },
        now: "2026-05-01T10:08:00.000Z",
      });
      expect(rerun.lifecycleState).toBe("rerun_reused");
      expect(rerun.previousRunId).toBe(first.runId);
      expect(rerun.answeredQuestions).toContainEqual(
        expect.objectContaining({ questionId: question.id }),
      );
      expect(readFileSync(rerun.artifactPaths!.changesSinceLastMd, "utf8")).toContain(
        `Previous run: ${first.runId}`,
      );
      expect(readFileSync(rerun.artifactPaths!.decisionsJsonl, "utf8")).toContain(
        "decision-persistence-integration",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  maybeIt("keeps two repositories isolated behind the same local server install", () => {
    const repoA = tempRepo();
    const repoB = tempRepo();
    try {
      const a = captureAssessment({
        repoRoot: repoA,
        event: { ...thresholdEvent, cwd: repoA, userRequest: "Assess repo A" },
        now: "2026-05-01T10:10:00.000Z",
      });
      const b = captureAssessment({
        repoRoot: repoB,
        event: { ...thresholdEvent, cwd: repoB, userRequest: "Assess repo B" },
        now: "2026-05-01T10:11:00.000Z",
      });
      expect(a.storePath).toBe(join(repoA, ".ceetrix", "tech-lead", "tech-lead.db"));
      expect(b.storePath).toBe(join(repoB, ".ceetrix", "tech-lead", "tech-lead.db"));
      expect(a.storePath).not.toBe(b.storePath);

      const storeA = new TechLeadPersistenceStore(repoA);
      const storeB = new TechLeadPersistenceStore(repoB);
      expect(storeA.latestRun()?.repoRoot).toBe(repoA);
      expect(storeB.latestRun()?.repoRoot).toBe(repoB);
      storeA.close();
      storeB.close();
    } finally {
      rmSync(repoA, { recursive: true, force: true });
      rmSync(repoB, { recursive: true, force: true });
    }
  });

  maybeIt("persists compact lifecycle audit records without creating oversized artifacts", () => {
    const repo = tempRepo();
    const store = new TechLeadPersistenceStore(repo);

    try {
      store.appendLifecycleAudit({
        auditId: "audit-session-start",
        repoRoot: repo,
        kind: "SessionStart",
        mode: "advisory",
        effect: "inject",
        createdAt: "2026-05-01T00:00:00.000Z",
        correlationId: "session-1",
        action: "Continue",
        intervention: "note",
        reason: "Loaded compact context.",
        evidence: ["latest assessment projection exists"],
        questionIds: [],
        degraded: false,
      });
      store.appendLifecycleAudit({
        auditId: "audit-stop",
        repoRoot: repo,
        kind: "Stop",
        mode: "strict",
        effect: "block",
        createdAt: "2026-05-01T00:01:00.000Z",
        correlationId: "session-1",
        action: "Record decision",
        intervention: "recommend",
        reason: "Open decision remains.",
        evidence: ["question still open"],
        questionIds: ["question-storage"],
        degraded: false,
      });

      expect(store.listLifecycleAudit()).toEqual([
        expect.objectContaining({
          auditId: "audit-session-start",
          kind: "SessionStart",
          effect: "inject",
        }),
        expect.objectContaining({
          auditId: "audit-stop",
          kind: "Stop",
          effect: "block",
          questionIds: ["question-storage"],
        }),
      ]);
    } finally {
      store.close();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "archcoach-persistence-"));
}
