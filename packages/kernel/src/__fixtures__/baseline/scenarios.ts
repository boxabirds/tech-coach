import type { CoachEventEnvelope } from "../../protocol.js";
import type { OptionalSignalResult } from "../../../../signals/src/index.js";

export const baseEvent: CoachEventEnvelope = {
  host: "generic",
  event: "assessment",
  cwd: "/repo",
  recentRequests: [],
  changedFiles: [],
  repoSignals: { status: "absent" },
  memoryRefs: [],
  priorDecisions: [],
  optionalSignals: [],
};

export const brownfieldEvent: CoachEventEnvelope = {
  ...baseEvent,
  recentRequests: ["Add saved projects", "Add project tags"],
  changedFiles: [
    "src/pages/ProjectEditor.tsx",
    "src/lib/projectStorage.ts",
    "src/components/ProjectFilters.tsx",
  ],
};

export const brownfieldEvidence: OptionalSignalResult[] = [
  signal("layout", "file_layout", "high", [
    "React app with src/pages, src/components, and src/lib entrypoints",
  ]),
  signal("config", "configuration_boundary", "high", [
    "projectStorage repository writes project data to localStorage",
  ]),
  signal("imports", "import_relationship", "medium", [
    "ProjectEditor imports projectStorage and ProjectFilters uses URL serialization",
  ]),
  signal("tests", "test_posture", "medium", [
    "Vitest unit tests configured in package.json",
  ]),
];

export const broadDiffEvent: CoachEventEnvelope = {
  ...baseEvent,
  changedFiles: [
    "src/ui/Button.tsx",
    "src/api/projects.ts",
    "src/storage/projects.ts",
    "config/deploy.ts",
  ],
};

export function signal(
  source: string,
  category: OptionalSignalResult["category"],
  confidence: OptionalSignalResult["confidence"],
  evidence: string[],
): OptionalSignalResult {
  return {
    source,
    status: "present",
    category,
    freshness: "current",
    confidence,
    evidence,
  };
}
