import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

export const fileTreeProvider: OptionalSignalProvider = {
  name: "file-tree",
  collect(context: SignalContext): OptionalSignalResult {
    const files = uniqueFiles(context.knownFiles ?? context.changedFiles);
    if (files.length === 0) {
      return {
        source: "file-tree",
        status: "absent",
        category: "file_layout",
        freshness: "unknown",
        confidence: "low",
        evidence: [],
        error: "no file list available",
      };
    }

    const topDirs = summarizeTopDirectories(files);
    const extensions = summarizeExtensions(files);
    return {
      source: "file-tree",
      status: "present",
      category: "file_layout",
      freshness: "current",
      confidence: context.knownFiles ? "medium" : "low",
      evidence: [
        `files observed: ${files.length}`,
        `top directories: ${topDirs.join(", ") || "(root only)"}`,
        `extensions: ${extensions.join(", ") || "(none)"}`,
      ],
    };
  },
};

function summarizeTopDirectories(files: string[]): string[] {
  return topCounts(files.map((file) => file.includes("/") ? file.split("/")[0] : "."));
}

function summarizeExtensions(files: string[]): string[] {
  return topCounts(
    files.map((file) => {
      const last = file.split("/").pop() ?? file;
      const dot = last.lastIndexOf(".");
      return dot > -1 ? last.slice(dot + 1).toLowerCase() : "(none)";
    }),
  );
}

function topCounts(values: string[]): string[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([value, count]) => `${value}=${count}`);
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter((file) => file.trim().length > 0)));
}
