import {
  baseEvent,
  broadDiffEvent,
  brownfieldEvent,
  brownfieldEvidence,
  signal,
} from "../../../kernel/src/__fixtures__/baseline/scenarios.js";
import {
  localStorageDecision,
  revisitEvent,
} from "../../../kernel/src/__fixtures__/memory/scenarios.js";
import type { DecisionRecord } from "../../../kernel/src/memory.js";
import { telemetryFromEvidence } from "../../../kernel/src/telemetry.js";
import type { ArchitecturalTelemetryBundle } from "../../../kernel/src/telemetryTypes.js";

export const noActionEvent = {
  ...baseEvent,
  host: "mcp-fixture",
  userRequest: "Rename the dashboard title",
};

export const thresholdEvent = {
  ...brownfieldEvent,
  host: "mcp-fixture",
  userRequest: "Add saved project sharing and keep current project storage",
  optionalSignals: brownfieldEvidence,
};

export const thresholdTelemetry = telemetryFromEvidence({
  event: thresholdEvent,
  evidence: brownfieldEvidence,
  capturedAt: "2026-04-30T14:00:00.000Z",
  correlationId: "mcp-threshold",
});

export const malformedTelemetry: ArchitecturalTelemetryBundle = {
  ...thresholdTelemetry,
  repository: thresholdTelemetry.repository.map((item, index) => index === 0
    ? { ...item, family: "change" as "repository" }
    : item),
};

export const largeDiffTelemetry = telemetryFromEvidence({
  event: {
    ...broadDiffEvent,
    host: "mcp-fixture",
    userRequest: "Prepare broad import workflow changes for production use",
    optionalSignals: [
      signal("large-diff", "diagnostic", "medium", [
        Array.from({ length: 120 }, (_, index) => `changed module ${index}`).join("\n"),
      ]),
    ],
  },
  evidence: [
    signal("large-diff", "diagnostic", "medium", [
      Array.from({ length: 120 }, (_, index) => `changed module ${index}`).join("\n"),
    ]),
  ],
  capturedAt: "2026-04-30T14:10:00.000Z",
  correlationId: "mcp-large-diff",
});

export const revisitInput = {
  event: revisitEvent,
  memoryRecords: [localStorageDecision],
};

export const decisionToRecord: DecisionRecord = {
  id: "decision-mcp-storage",
  kind: "decision",
  adviceStatus: "active",
  concern: "data_storage",
  decision: "Keep localStorage for the private prototype",
  context: "Single user prototype before sharing",
  alternatives: ["SQLite", "Postgres"],
  reason: "The prototype does not need shared persistence yet.",
  risks: ["Sharing will require replacing storage"],
  state: "Exploratory",
  revisitIf: ["sharing"],
  createdAt: "2026-04-30T14:20:00.000Z",
  source: "coach",
};
