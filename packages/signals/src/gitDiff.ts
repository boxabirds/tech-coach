import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";
import type { EvidenceRole, EvidenceTimeframe } from "../../kernel/src/claimTypes.js";

export const gitDiffProvider: OptionalSignalProvider = {
  name: "git-diff",
  collect(context: SignalContext): OptionalSignalResult {
    if (context.changedFiles.length === 0) {
      return {
        source: "git-diff",
        status: "absent",
        category: "changed_file_spread",
        freshness: "current",
        confidence: "medium",
        evidence: [],
        error: "no changed files reported",
      };
    }

    const changedDirs = Array.from(
      new Set(context.changedFiles.map((file) => file.includes("/") ? file.split("/")[0] : ".")),
    ).sort();

    return {
      source: "git-diff",
      status: "present",
      category: "changed_file_spread",
      freshness: "current",
      confidence: "medium",
      evidence: [
        `changed files: ${context.changedFiles.length}`,
        `changed areas: ${changedDirs.join(", ")}`,
        ...context.changedFiles.slice(0, 12),
      ],
      details: {
        temporalEvidence: context.changedFiles.slice(0, 24).map((path) => ({
          path,
          ...temporalForChangedPath(path),
          summary: "Uncommitted file status is an attention signal, not proof of active project direction.",
        })),
      },
    };
  },
};

function temporalForChangedPath(
  path: string,
): { timeframe: EvidenceTimeframe; role: EvidenceRole } {
  if (/^pocs?\//i.test(path) || /(^|\/)(prototype|experiment|lab)s?\//i.test(path)) {
    return { timeframe: "past", role: "experiment" };
  }
  if (/^docs\/(design|architecture)(\/|\.|$)/i.test(path) || /(^|\/)(tech-architecture|technical-architecture|architecture)\.md$/i.test(path)) {
    return { timeframe: "future", role: "architecture_basis" };
  }
  if (/^docs\/adr\//i.test(path)) {
    return { timeframe: "past", role: "decision_record" };
  }
  return { timeframe: "uncertain", role: "work_in_progress" };
}
