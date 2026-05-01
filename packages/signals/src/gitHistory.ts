import type { GitHistoryRecord } from "./historyTypes.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type GitHistorySummary = {
  evidence: string[];
  technicalSignals: number;
  outcomeSignals: number;
  riskSignals: number;
  churnSignals: number;
  repairSignals: number;
};

const technicalTerms = ["refactor", "api", "schema", "migration", "storage", "auth", "deploy", "architecture"];
const outcomeTerms = ["share", "search", "export", "user", "customer", "workflow"];
const riskTerms = ["security", "privacy", "gdpr", "audit", "permission", "rollback"];
const repairTerms = ["fix", "bug", "broken", "regression", "hotfix"];
const execFileAsync = promisify(execFile);

export async function loadGitHistory(
  cwd: string,
  maxRecords = 100,
): Promise<GitHistoryRecord[]> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    cwd,
    "log",
    `--max-count=${maxRecords}`,
    "--date=iso-strict",
    "--name-only",
    "--pretty=format:%H%x1f%aI%x1f%s",
  ], { maxBuffer: 1024 * 1024 * 4 });

  return parseGitLog(stdout);
}

export function parseGitLog(output: string): GitHistoryRecord[] {
  const records: GitHistoryRecord[] = [];
  let current: GitHistoryRecord | undefined;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const fields = trimmed.split("\x1f");
    if (fields.length >= 3) {
      current = {
        hash: fields[0],
        timestamp: fields[1],
        subject: fields.slice(2).join("\x1f"),
        files: [],
      };
      records.push(current);
      continue;
    }
    current?.files?.push(trimmed);
  }
  return records.filter((record) => record.subject.length > 0);
}

export function summarizeGitHistory(
  commits: GitHistoryRecord[] = [],
  maxRecords = 100,
): GitHistorySummary {
  const selected = commits.slice(-maxRecords);
  const subjects = selected.map((commit) => `${commit.subject}\n${commit.body ?? ""}`).join("\n").toLowerCase();
  const touchedRoots = new Map<string, number>();
  for (const commit of selected) {
    for (const file of commit.files ?? []) {
      const root = file.includes("/") ? file.split("/")[0] : ".";
      touchedRoots.set(root, (touchedRoots.get(root) ?? 0) + 1);
    }
  }
  const churnSignals = Array.from(touchedRoots.values()).filter((count) => count >= 3).length;

  return {
    technicalSignals: countTerms(subjects, technicalTerms),
    outcomeSignals: countTerms(subjects, outcomeTerms),
    riskSignals: countTerms(subjects, riskTerms),
    repairSignals: countTerms(subjects, repairTerms),
    churnSignals,
    evidence: [
      `git commits analyzed: ${selected.length}`,
      `git technical signals: ${countTerms(subjects, technicalTerms)}`,
      `git outcome signals: ${countTerms(subjects, outcomeTerms)}`,
      `git risk/compliance signals: ${countTerms(subjects, riskTerms)}`,
      `git repair loop signals: ${countTerms(subjects, repairTerms)}`,
      `git churn clusters: ${churnSignals}`,
    ],
  };
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
