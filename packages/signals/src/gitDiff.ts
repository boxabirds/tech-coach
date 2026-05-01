import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

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
    };
  },
};
