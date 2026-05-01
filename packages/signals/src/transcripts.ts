import type { HistoryTranscriptRecord } from "./historyTypes.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type TranscriptSummary = {
  evidence: string[];
  technicalSignals: number;
  outcomeSignals: number;
  riskSignals: number;
  repairSignals: number;
  directionSignals: number;
};

const technicalTerms = [
  "sql",
  "nosql",
  "database",
  "schema",
  "api",
  "hook",
  "component",
  "interface",
  "abstraction",
  "refactor",
  "architecture",
];
const outcomeTerms = ["user", "customer", "business", "outcome", "sharing", "search", "export", "workflow"];
const riskTerms = ["gdpr", "privacy", "compliance", "audit", "retention", "deletion", "permission", "security"];
const repairTerms = ["fix bug", "fix the bug", "make it better", "broken", "doesn't work", "try again"];
const directionTerms = ["use ", "implement ", "refactor ", "extract ", "design ", "architecture "];

export type TranscriptDiscoveryInput = {
  cwd: string;
  homeDir?: string;
  manualPaths?: string[];
  maxFiles?: number;
};

export async function discoverTranscriptPaths(
  input: TranscriptDiscoveryInput,
): Promise<string[]> {
  const home = input.homeDir ?? homedir();
  const candidates = [
    ...(input.manualPaths ?? []),
    join(home, ".claude", "projects", encodeClaudeProjectPath(input.cwd)),
    join(home, ".gemini", "conversations"),
    join(home, ".gemini", "history"),
    join(home, ".codex", "sessions"),
  ];
  const paths: string[] = [];
  for (const candidate of candidates) {
    paths.push(...await collectReadableTranscriptFiles(candidate, input.maxFiles ?? 20));
    if (paths.length >= (input.maxFiles ?? 20)) {
      break;
    }
  }
  return Array.from(new Set(paths)).slice(0, input.maxFiles ?? 20);
}

export async function loadTranscriptRecords(
  paths: string[],
  maxRecords = 100,
): Promise<HistoryTranscriptRecord[]> {
  const records: HistoryTranscriptRecord[] = [];
  for (const path of paths) {
    records.push(...await readTranscriptPath(path));
    if (records.length >= maxRecords) {
      break;
    }
  }
  return records.slice(-maxRecords);
}

export function summarizeTranscripts(
  records: HistoryTranscriptRecord[] = [],
  maxRecords = 50,
): TranscriptSummary {
  const selected = records
    .filter((record) => record.speaker === "user")
    .slice(-maxRecords);
  const text = selected.map((record) => record.text).join("\n").toLowerCase();
  const technicalSignals = countTerms(text, technicalTerms);
  const outcomeSignals = countTerms(text, outcomeTerms);
  const riskSignals = countTerms(text, riskTerms);
  const repairSignals = countTerms(text, repairTerms);
  const directionSignals = countTerms(text, directionTerms);

  return {
    technicalSignals,
    outcomeSignals,
    riskSignals,
    repairSignals,
    directionSignals,
    evidence: [
      `agent transcript user turns: ${selected.length}`,
      `technical language signals: ${technicalSignals}`,
      `outcome language signals: ${outcomeSignals}`,
      `risk/compliance language signals: ${riskSignals}`,
      `repair loop signals: ${repairSignals}`,
      `user direction specificity signals: ${directionSignals}`,
    ],
  };
}

export function redactTranscriptText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\/Users\/[^\s]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[redacted-path]");
}

async function collectReadableTranscriptFiles(
  path: string,
  maxFiles: number,
): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return isTranscriptFile(path) ? [path] : [];
    }
    if (!info.isDirectory()) {
      return [];
    }

    const entries = await readdir(path, { withFileTypes: true });
    const files: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isFile() && isTranscriptFile(child)) {
        const childInfo = await stat(child);
        files.push({ path: child, mtimeMs: childInfo.mtimeMs });
      }
      if (entry.isDirectory() && files.length < maxFiles) {
        for (const nested of await collectReadableTranscriptFiles(child, maxFiles)) {
          const nestedInfo = await stat(nested);
          files.push({ path: nested, mtimeMs: nestedInfo.mtimeMs });
        }
      }
    }
    return files
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .map((file) => file.path)
      .slice(0, maxFiles);
  } catch {
    return [];
  }
}

async function readTranscriptPath(path: string): Promise<HistoryTranscriptRecord[]> {
  const text = await readFile(path, "utf8");
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (path.endsWith(".jsonl")) {
    return trimmed
      .split(/\r?\n/)
      .flatMap((line) => transcriptRecordsFromJson(safeParseJson(line), path));
  }
  if (path.endsWith(".json")) {
    return transcriptRecordsFromJson(safeParseJson(trimmed), path);
  }
  return [{
    speaker: "user",
    text: trimmed,
    source: path,
  }];
}

function transcriptRecordsFromJson(
  value: unknown,
  source: string,
): HistoryTranscriptRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => transcriptRecordsFromJson(item, source));
  }
  if (!isRecord(value)) {
    return [];
  }

  const direct = transcriptRecordFromObject(value, source);
  const nested = [
    value.messages,
    value.conversation,
    value.turns,
    value.entries,
  ].flatMap((item) => transcriptRecordsFromJson(item, source));

  return direct ? [direct, ...nested] : nested;
}

function transcriptRecordFromObject(
  value: Record<string, unknown>,
  source: string,
): HistoryTranscriptRecord | undefined {
  const speaker = normalizeSpeaker(
    readString(value, "speaker")
      ?? readString(value, "role")
      ?? readString(value, "type"),
  );
  const text = readTranscriptText(value);
  if (!speaker || !text) {
    return undefined;
  }
  return {
    speaker,
    text,
    timestamp: readString(value, "timestamp") ?? readString(value, "created_at"),
    source,
  };
}

function readTranscriptText(value: Record<string, unknown>): string | undefined {
  return readString(value, "text")
    ?? readString(value, "content")
    ?? readString(value, "prompt")
    ?? textFromMessage(value.message);
}

function textFromMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const content = value.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => isRecord(item) ? readString(item, "text") : undefined)
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

function normalizeSpeaker(value: string | undefined): HistoryTranscriptRecord["speaker"] | undefined {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") {
    return value;
  }
  if (value === "human") {
    return "user";
  }
  if (value === "agent" || value === "model") {
    return "assistant";
  }
  return undefined;
}

function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[\\/]/g, "-");
}

function isTranscriptFile(path: string): boolean {
  return /\.(jsonl|json|md|txt)$/i.test(path);
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
