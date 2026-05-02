import type { OptionalSignalResult } from "../../../../signals/src/index.js";
import type { CoachEventEnvelope } from "../../protocol.js";

export const telemetryEvent: CoachEventEnvelope = {
  host: "claude-code",
  event: "PostToolBatch",
  cwd: "/repo",
  userRequest: "Let teammates share projects",
  recentRequests: ["Add saved projects", "Add project tags"],
  changedFiles: [
    "src/pages/ProjectEditor.tsx",
    "src/lib/projectStorage.ts",
  ],
  repoSignals: {
    status: "present",
    evidence: ["React app with src/pages and src/lib"],
  },
  testSummary: {
    status: "not_run",
    summary: "Tests were not run after this change",
  },
  memoryRefs: ["decision-localstorage-projects"],
  priorDecisions: [
    {
      id: "decision-localstorage-projects",
      kind: "accepted_debt",
      adviceStatus: "active",
      concern: "data_storage",
      decision: "Use localStorage while the project is single-user",
      revisitIf: ["sharing", "sync", "user accounts"],
      pressure: "medium",
      support: "localized",
      adequacyStatus: "under_structured",
      acceptedRisk: "Data cannot be shared across users",
      evidenceRefs: ["fact-data_storage-localstorage"],
    },
  ],
  optionalSignals: [],
};

export const mixedEvidence: OptionalSignalResult[] = [
  signal("layout", "file_layout", "present", "current", "high", [
    "React app with src/pages and src/components",
  ]),
  signal("imports", "import_relationship", "present", "current", "medium", [
    "ProjectEditor imports projectStorage",
  ]),
  signal("tests", "test_posture", "present", "stale", "medium", [
    "Vitest configured but not run",
  ]),
  signal("runtime", "runtime_error", "present", "current", "high", [
    "Runtime error reported after deployment",
  ]),
];

export const absentAndFailedEvidence: OptionalSignalResult[] = [
  signal("lsp", "symbol_reference", "absent", "unknown", "low", []),
  {
    ...signal("monitor", "monitor_event", "failed", "unknown", "low", []),
    error: "monitor unavailable",
  },
];

export const weakEvidence: OptionalSignalResult[] = [
  signal("prompt-snippet", "symbol_reference", "present", "current", "low", [
    "Maybe localStorage will be used later",
  ]),
];

export function signal(
  source: string,
  category: OptionalSignalResult["category"],
  status: OptionalSignalResult["status"],
  freshness: OptionalSignalResult["freshness"],
  confidence: OptionalSignalResult["confidence"],
  evidence: string[],
): OptionalSignalResult {
  return {
    source,
    status,
    category,
    freshness,
    confidence,
    evidence,
  };
}
