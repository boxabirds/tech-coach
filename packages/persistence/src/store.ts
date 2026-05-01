import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import type {
  AssessmentRunSnapshot,
  ConfirmPersistedDecisionInput,
  PersistedAnswer,
  PersistedDecision,
  PersistenceDiagnostic,
} from "./types.js";
import {
  defaultDatabaseFile,
  defaultPersistenceDir,
} from "./types.js";

type SqliteStatement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  query: (sql: string) => SqliteStatement;
  close?: () => void;
};

export type StoreOptions = {
  persistenceDir?: string;
  databaseFile?: string;
  database?: SqliteDatabase;
};

export class PersistenceStoreError extends Error {
  readonly diagnostics: PersistenceDiagnostic[];

  constructor(message: string, diagnostics: PersistenceDiagnostic[]) {
    super(message);
    this.name = "PersistenceStoreError";
    this.diagnostics = diagnostics;
  }
}

export class TechLeadPersistenceStore {
  readonly repoRoot: string;
  readonly storeDir: string;
  readonly databasePath: string;
  private readonly database: SqliteDatabase;

  constructor(repoRoot: string, options: StoreOptions = {}) {
    if (!repoRoot || repoRoot.trim().length === 0) {
      throw new PersistenceStoreError("Repository root is required for persistence.", [
        {
          id: "persistence-repo-root-required",
          severity: "error",
          source: "persistence",
          message: "Repository root is required for persistence.",
        },
      ]);
    }

    this.repoRoot = resolve(repoRoot);
    this.storeDir = resolve(
      this.repoRoot,
      options.persistenceDir ?? defaultPersistenceDir,
    );
    this.databasePath = resolve(
      this.storeDir,
      options.databaseFile ?? defaultDatabaseFile,
    );
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.database = options.database ?? openBunSqliteDatabase(this.databasePath);
    this.migrate();
  }

  close(): void {
    this.database.close?.();
  }

  saveRun(run: AssessmentRunSnapshot): void {
    this.transaction(() => {
      this.database.query(
        `insert into assessment_runs (
          run_id, repo_root, captured_at, previous_run_id, lifecycle_state,
          durable_record_created, assessment_json, telemetry_json, input_json,
          diagnostics_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        run.runId,
        run.repoRoot,
        run.capturedAt,
        run.previousRunId ?? null,
        run.lifecycleState,
        run.durableRecordCreated ? 1 : 0,
        stringify(run.assessment),
        stringify(run.telemetry ?? null),
        stringify(run.input ?? null),
        stringify(run.diagnostics),
      );
      this.setMeta("latest_run_id", run.runId);
    });
  }

  latestRun(): AssessmentRunSnapshot | undefined {
    const latestRunId = this.getMeta("latest_run_id");
    return latestRunId ? this.getRun(latestRunId) : undefined;
  }

  getRun(runId: string): AssessmentRunSnapshot | undefined {
    const row = this.database.query(
      "select * from assessment_runs where run_id = ?",
    ).get(runId) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : undefined;
  }

  listRuns(): AssessmentRunSnapshot[] {
    return this.database.query(
      "select * from assessment_runs order by captured_at asc, run_id asc",
    ).all().map((row) => rowToRun(row as Record<string, unknown>));
  }

  saveArtifact(runId: string, name: string, path: string): void {
    this.database.query(
      `insert into artifacts (run_id, name, path, updated_at)
       values (?, ?, ?, datetime('now'))
       on conflict(run_id, name) do update set
         path = excluded.path,
         updated_at = excluded.updated_at`,
    ).run(runId, name, path);
  }

  appendAnswer(answer: PersistedAnswer): PersistedAnswer {
    this.database.query(
      `insert into answers (
        answer_id, question_id, run_id, action, status, value, note,
        recorded_at, source, answer_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      answer.answerId,
      answer.questionId,
      answer.runId ?? null,
      answer.action,
      answer.status,
      answer.value ?? null,
      answer.note ?? null,
      answer.recordedAt,
      answer.source ?? "host",
      stringify(answer),
    );
    return answer;
  }

  listAnswers(): PersistedAnswer[] {
    return this.database.query(
      "select answer_json from answers order by recorded_at asc, answer_id asc",
    ).all().map((row) => parseJsonField(row as Record<string, unknown>, "answer_json") as PersistedAnswer);
  }

  appendDecision(input: ConfirmPersistedDecisionInput): PersistedDecision {
    if (!input.confirmed) {
      throw new PersistenceStoreError("Durable decisions require explicit user confirmation.", [
        {
          id: "decision-confirmation-required",
          severity: "error",
          source: "persistence",
          message: "Durable decisions require explicit user confirmation.",
        },
      ]);
    }
    const decision: PersistedDecision = {
      ...input.decision,
      ...(input.runId ? { runId: input.runId } : {}),
      confirmedAt: input.now ?? new Date().toISOString(),
    };
    this.database.query(
      `insert into decisions (
        decision_id, run_id, confirmed_at, decision_json
      ) values (?, ?, ?, ?)`,
    ).run(
      decision.id,
      decision.runId ?? null,
      decision.confirmedAt ?? decision.createdAt,
      stringify(decision),
    );
    return decision;
  }

  listDecisions(): PersistedDecision[] {
    return this.database.query(
      "select decision_json from decisions order by confirmed_at asc, decision_id asc",
    ).all().map((row) => parseJsonField(row as Record<string, unknown>, "decision_json") as PersistedDecision);
  }

  diagnostics(): PersistenceDiagnostic[] {
    try {
      this.database.query("select count(*) as count from assessment_runs").get();
      return [];
    } catch (error) {
      return [{
        id: "persistence-store-unreadable",
        severity: "error",
        source: this.databasePath,
        message: `Persistence store could not be read: ${errorMessage(error)}`,
      }];
    }
  }

  private migrate(): void {
    this.database.exec(`
      create table if not exists meta (
        key text primary key,
        value text not null
      );
      create table if not exists assessment_runs (
        run_id text primary key,
        repo_root text not null,
        captured_at text not null,
        previous_run_id text,
        lifecycle_state text not null,
        durable_record_created integer not null,
        assessment_json text not null,
        telemetry_json text,
        input_json text,
        diagnostics_json text not null
      );
      create table if not exists answers (
        answer_id text primary key,
        question_id text not null,
        run_id text,
        action text not null,
        status text not null,
        value text,
        note text,
        recorded_at text not null,
        source text,
        answer_json text not null
      );
      create table if not exists decisions (
        decision_id text primary key,
        run_id text,
        confirmed_at text not null,
        decision_json text not null
      );
      create table if not exists artifacts (
        run_id text not null,
        name text not null,
        path text not null,
        updated_at text not null,
        primary key (run_id, name)
      );
    `);
    this.setMeta("schema_version", "1");
  }

  private setMeta(key: string, value: string): void {
    this.database.query(
      `insert into meta (key, value) values (?, ?)
       on conflict(key) do update set value = excluded.value`,
    ).run(key, value);
  }

  private getMeta(key: string): string | undefined {
    const row = this.database.query("select value from meta where key = ?").get(key) as
      | { value?: unknown }
      | undefined;
    return typeof row?.value === "string" ? row.value : undefined;
  }

  private transaction(operation: () => void): void {
    this.database.exec("begin immediate");
    try {
      operation();
      this.database.exec("commit");
    } catch (error) {
      try {
        this.database.exec("rollback");
      } catch {
        // Ignore rollback failures; the original error is more useful.
      }
      throw error;
    }
  }
}

export function openPersistenceStore(
  repoRoot: string,
  options: StoreOptions = {},
): TechLeadPersistenceStore {
  return new TechLeadPersistenceStore(repoRoot, options);
}

function openBunSqliteDatabase(path: string): SqliteDatabase {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("bun:sqlite") as { Database: new (path: string) => SqliteDatabase };
    return new mod.Database(path);
  } catch (error) {
    throw new PersistenceStoreError("bun:sqlite is required for Tech Lead persistence.", [
      {
        id: "bun-sqlite-unavailable",
        severity: "error",
        source: "bun:sqlite",
        message: `bun:sqlite is required for Tech Lead persistence: ${errorMessage(error)}`,
      },
    ]);
  }
}

function rowToRun(row: Record<string, unknown>): AssessmentRunSnapshot {
  return {
    runId: String(row.run_id),
    repoRoot: String(row.repo_root),
    capturedAt: String(row.captured_at),
    ...(typeof row.previous_run_id === "string" ? { previousRunId: row.previous_run_id } : {}),
    lifecycleState: String(row.lifecycle_state) as AssessmentRunSnapshot["lifecycleState"],
    durableRecordCreated: Boolean(row.durable_record_created),
    assessment: parseJsonField(row, "assessment_json") as AssessmentRunSnapshot["assessment"],
    telemetry: parseJsonField(row, "telemetry_json") as AssessmentRunSnapshot["telemetry"],
    input: parseJsonField(row, "input_json") as AssessmentRunSnapshot["input"],
    diagnostics: parseJsonField(row, "diagnostics_json") as PersistenceDiagnostic[],
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonField(row: Record<string, unknown>, field: string): unknown {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return JSON.parse(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
