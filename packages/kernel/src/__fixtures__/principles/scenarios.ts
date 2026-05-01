import type { OptionalSignalResult } from "../../../../signals/src/index.js";
import type { CoachEventEnvelope } from "../../protocol.js";
import { baseEvent, brownfieldEvent, signal } from "../baseline/scenarios.js";

export const reactStateOwnershipEvent: CoachEventEnvelope = {
  ...brownfieldEvent,
  userRequest: "Add another project editor state feature",
  recentRequests: ["Add saved projects", "Add project filters"],
  optionalSignals: [
    signal("symbols", "symbol_reference", "high", [
      "ProjectEditor imports projectStorage, uses useState, and handles URL serialization",
    ]),
  ],
};

export const storageBoundaryEvent: CoachEventEnvelope = {
  ...brownfieldEvent,
  userRequest: "Add project tags to saved projects",
  optionalSignals: [
    signal("storage", "configuration_boundary", "high", [
      "projectStorage repository stores saved projects in localStorage",
    ]),
  ],
};

export const exploratoryEvent: CoachEventEnvelope = {
  ...baseEvent,
  userRequest: "Create a tiny static prototype",
};

export const weakStorageEvent: CoachEventEnvelope = {
  ...baseEvent,
  userRequest: "Maybe save this later",
  optionalSignals: [
    {
      ...signal("prompt", "symbol_reference", "low", [
        "Maybe localStorage will be used later",
      ]),
      freshness: "stale",
    } satisfies OptionalSignalResult,
  ],
};
