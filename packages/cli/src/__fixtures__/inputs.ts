import {
  brownfieldEvent,
  brownfieldEvidence,
} from "../../../kernel/src/__fixtures__/baseline/scenarios.js";
import { revisitEvent } from "../../../kernel/src/__fixtures__/memory/scenarios.js";
import { telemetryFromEvidence } from "../../../kernel/src/telemetry.js";

export const cliEventInput = {
  ...brownfieldEvent,
  optionalSignals: brownfieldEvidence,
};

export const cliTelemetryInput = telemetryFromEvidence({
  event: cliEventInput,
  evidence: brownfieldEvidence,
  capturedAt: "2026-04-30T14:00:00.000Z",
  correlationId: "cli-fixture",
});

export const cliRevisitInput = revisitEvent;

export const invalidCliInput = {
  host: "generic",
  event: "assessment",
};
