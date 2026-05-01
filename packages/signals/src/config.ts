import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

const configNamePattern = /(^|\/)(package\.json|bun\.lock|tsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s|wrangler\.toml|dockerfile|docker-compose\.ya?ml|\.github\/workflows\/.+\.ya?ml|\.env(\..*)?|terraform\/|infra\/)/i;

export const configBoundaryProvider: OptionalSignalProvider = {
  name: "config-boundary",
  collect(context: SignalContext): OptionalSignalResult {
    const files = Array.from(new Set([...(context.knownFiles ?? []), ...context.changedFiles]));
    const configFiles = files.filter((file) => configNamePattern.test(file));
    if (configFiles.length === 0) {
      return {
        source: "config-boundary",
        status: "absent",
        category: "configuration_boundary",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no configuration or deployment boundary files observed",
      };
    }

    return {
      source: "config-boundary",
      status: "present",
      category: "configuration_boundary",
      freshness: "current",
      confidence: "medium",
      evidence: [
        `configuration files observed: ${configFiles.length}`,
        ...configFiles.slice(0, 12),
      ],
    };
  },
};
