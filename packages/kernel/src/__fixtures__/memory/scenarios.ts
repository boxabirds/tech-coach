import type { CoachEventEnvelope } from "../../protocol.js";
import type { DecisionRecord } from "../../memory.js";

export const localStorageDecision: DecisionRecord = {
  id: "decision-localstorage-projects",
  kind: "accepted_debt",
  adviceStatus: "active",
  concern: "data_storage",
  decision: "Use localStorage while saved projects are single-user only",
  context: "Early prototype with no accounts or sharing",
  alternatives: ["SQLite", "Postgres", "Cloud KV"],
  reason: "Local-only storage kept the prototype simple before collaboration existed.",
  risks: ["Data cannot be shared across users", "Browser storage can be cleared"],
  state: "Exploratory",
  revisitIf: ["sharing", "sync", "user accounts"],
  createdAt: "2026-04-30T12:00:00.000Z",
  source: "coach",
  pressure: "medium",
  support: "localized",
  adequacyStatus: "under_structured",
  acceptedRisk: "Data cannot be shared across users; browser storage can be cleared",
  evidenceRefs: ["fact-data_storage-localstorage"],
};

export const authShortcutDecision: DecisionRecord = {
  id: "decision-no-auth",
  kind: "decision",
  adviceStatus: "active",
  concern: "authentication",
  decision: "Skip authentication while the app is local-only",
  context: "Single developer workflow",
  alternatives: ["Password login", "OAuth", "Session cookies"],
  reason: "The tool was not deployed or shared.",
  risks: ["Public deployment would expose private data"],
  state: "Exploratory",
  revisitIf: ["public deployment", "team access"],
  createdAt: "2026-04-30T12:10:00.000Z",
  source: "user",
};

export const revisitEvent: CoachEventEnvelope = {
  host: "claude-code",
  event: "PostToolBatch",
  cwd: "/repo",
  userRequest: "Let teammates enable sharing for saved projects",
  recentRequests: ["Add project tags", "Sync saved projects between devices"],
  changedFiles: [
    "src/pages/ProjectEditor.tsx",
    "src/lib/projectStorage.ts",
  ],
  repoSignals: {
    status: "present",
    evidence: ["projectStorage currently writes saved projects to localStorage"],
  },
  memoryRefs: ["decision-localstorage-projects"],
  priorDecisions: [],
  optionalSignals: [],
};

export const nonMatchingEvent: CoachEventEnvelope = {
  ...revisitEvent,
  userRequest: "Rename the project editor heading",
  recentRequests: [],
  changedFiles: ["src/pages/ProjectEditor.tsx"],
  repoSignals: { status: "present", evidence: ["React page copy update"] },
};

export const invalidDecision = {
  id: "",
  kind: "",
  adviceStatus: "",
  concern: "project persistence",
  decision: "Use localStorage",
  context: "Prototype",
  alternatives: [],
  reason: "",
  risks: [],
  state: "Experimental",
  revisitIf: [],
  createdAt: "",
  source: "system",
};
