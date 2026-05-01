import type { CeetrixHistoryRecord } from "./historyTypes.js";
import { readFile } from "node:fs/promises";

export type CeetrixHistorySummary = {
  evidence: string[];
  technicalSignals: number;
  outcomeSignals: number;
  riskSignals: number;
  reworkSignals: number;
  decisionSignals: number;
};

const technicalTerms = ["design", "capability", "contract", "implementation", "schema", "api", "test"];
const outcomeTerms = ["user", "experience", "business", "outcome", "acceptance", "workflow"];
const riskTerms = ["security", "privacy", "compliance", "rollback", "audit", "permission"];
const reworkTerms = ["rework", "correction", "missed", "failed", "retrospective", "stop doing"];

export async function loadCeetrixHistoryRecords(
  paths: string[],
  maxRecords = 100,
): Promise<CeetrixHistoryRecord[]> {
  const records: CeetrixHistoryRecord[] = [];
  for (const path of paths) {
    records.push(...await readCeetrixHistoryPath(path));
    if (records.length >= maxRecords) {
      break;
    }
  }
  return records.slice(-maxRecords);
}

export function summarizeCeetrixHistory(
  records: CeetrixHistoryRecord[] = [],
  maxRecords = 100,
): CeetrixHistorySummary {
  const selected = records.slice(-maxRecords);
  const text = selected.map((record) =>
    `${record.kind} ${record.title ?? ""}\n${record.body ?? ""}\n${record.status ?? ""}`
  ).join("\n").toLowerCase();
  const decisionSignals = selected.filter((record) =>
    record.kind === "decision"
    || record.kind === "story"
    || record.kind === "task"
  ).length;

  return {
    technicalSignals: countTerms(text, technicalTerms),
    outcomeSignals: countTerms(text, outcomeTerms),
    riskSignals: countTerms(text, riskTerms),
    reworkSignals: countTerms(text, reworkTerms),
    decisionSignals,
    evidence: [
      `Ceetrix records analyzed: ${selected.length}`,
      `Ceetrix decision/task signals: ${decisionSignals}`,
      `Ceetrix technical signals: ${countTerms(text, technicalTerms)}`,
      `Ceetrix outcome signals: ${countTerms(text, outcomeTerms)}`,
      `Ceetrix risk/compliance signals: ${countTerms(text, riskTerms)}`,
      `Ceetrix rework signals: ${countTerms(text, reworkTerms)}`,
    ],
  };
}

async function readCeetrixHistoryPath(path: string): Promise<CeetrixHistoryRecord[]> {
  const text = (await readFile(path, "utf8")).trim();
  if (!text) {
    return [];
  }
  if (path.endsWith(".jsonl")) {
    return text
      .split(/\r?\n/)
      .flatMap((line) => ceetrixRecordsFromJson(safeParseJson(line)));
  }
  return ceetrixRecordsFromJson(safeParseJson(text));
}

function ceetrixRecordsFromJson(value: unknown): CeetrixHistoryRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => ceetrixRecordsFromJson(item));
  }
  if (!isRecord(value)) {
    return [];
  }
  if ("records" in value) {
    return ceetrixRecordsFromJson(value.records);
  }
  if ("stories" in value || "tasks" in value || "comments" in value) {
    return [
      ...ceetrixRecordsFromJson(value.stories),
      ...ceetrixRecordsFromJson(value.tasks),
      ...ceetrixRecordsFromJson(value.comments),
    ];
  }

  const kind = normalizeKind(readString(value, "kind") ?? readString(value, "type"));
  if (!kind) {
    return [];
  }
  return [{
    kind,
    title: readString(value, "title") ?? readString(value, "name"),
    body: readString(value, "body") ?? readString(value, "description") ?? readString(value, "summary"),
    status: readString(value, "status"),
    timestamp: readString(value, "timestamp") ?? readString(value, "updatedAt") ?? readString(value, "createdAt"),
  }];
}

function normalizeKind(value: string | undefined): CeetrixHistoryRecord["kind"] | undefined {
  if (
    value === "story"
    || value === "task"
    || value === "comment"
    || value === "decision"
    || value === "retrospective"
  ) {
    return value;
  }
  return undefined;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countTerms(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + occurrences(text, term), 0);
}

function occurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}
