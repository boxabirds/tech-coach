import type { OptionalSignalResult } from "../../packages/signals/src/index.js";
import type { CoachEventEnvelope } from "../../packages/kernel/src/protocol.js";
import { telemetryFromEvidence } from "../../packages/kernel/src/telemetry.js";
import {
  authShortcutDecision,
  localStorageDecision,
} from "../../packages/kernel/src/__fixtures__/memory/scenarios.js";
import type { ScenarioFixture } from "../../packages/evaluation/src/runner.js";

const baseEvent: CoachEventEnvelope = {
  host: "fixture",
  event: "assessment",
  cwd: "/repo",
  recentRequests: [],
  changedFiles: [],
  repoSignals: { status: "absent" },
  memoryRefs: [],
  priorDecisions: [],
  optionalSignals: [],
};

export const simpleFirstFeature: ScenarioFixture = {
  name: "simple-first-feature-stays-quiet",
  event: {
    ...baseEvent,
    userRequest: "Rename the dashboard heading",
  },
  memory: [],
  expectation: {
    requiredThresholds: [],
    allowedInterventions: ["note"],
    expectedActions: ["Continue"],
    forbiddenActions: ["Insert boundary", "Replace substrate", "Run review"],
    requiredSignalFamilies: ["lifecycle"],
    requiredEvidenceCategories: [],
    expectedSilence: true,
  },
};

export const repeatedState: ScenarioFixture = withEvidence({
  name: "repeated-state-needs-decision",
  event: {
    ...baseEvent,
    userRequest: "Add another filter that syncs with the project list",
    recentRequests: ["Add filter state", "Serialize project filters into the URL"],
    changedFiles: [
      "src/pages/ProjectList.tsx",
      "src/components/ProjectFilters.tsx",
      "src/lib/filterState.ts",
    ],
  },
  evidence: [
    signal("state", "symbol_reference", "medium", [
      "ProjectFilters shares filter state with ProjectList and URL serialization",
    ]),
  ],
  expectation: {
    requiredThresholds: ["state_ownership"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Replace substrate"],
    requiredSignalFamilies: ["lifecycle", "change"],
    requiredEvidenceCategories: ["symbol_reference"],
  },
});

export const persistence: ScenarioFixture = withEvidence({
  name: "persistence-needs-storage-decision",
  event: {
    ...baseEvent,
    userRequest: "Save projects between browser sessions",
    recentRequests: ["Add saved projects", "Add project tags"],
    changedFiles: ["src/lib/projectStorage.ts", "src/pages/ProjectEditor.tsx"],
  },
  evidence: [
    signal("storage", "configuration_boundary", "high", [
      "projectStorage repository writes saved project data to localStorage",
    ]),
    signal("tests", "test_posture", "medium", [
      "Vitest unit tests cover projectStorage save and load behavior",
    ]),
  ],
  expectation: {
    requiredThresholds: ["persistence"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Insert boundary"],
    requiredSignalFamilies: ["lifecycle", "repository", "test"],
    requiredEvidenceCategories: ["configuration_boundary", "test_posture"],
  },
});

export const expiredAssumption: ScenarioFixture = withEvidence({
  name: "expired-localstorage-assumption-recommends-substrate-replacement",
  event: {
    ...baseEvent,
    userRequest: "Let teammates share saved projects across devices",
    recentRequests: ["Sync saved projects between devices"],
    changedFiles: ["src/lib/projectStorage.ts", "src/api/projects.ts"],
    memoryRefs: ["decision-localstorage-projects"],
  },
  evidence: [
    signal("storage", "configuration_boundary", "high", [
      "projectStorage currently stores saved projects in localStorage before sharing",
    ]),
  ],
  memory: [localStorageDecision],
  expectation: {
    requiredThresholds: ["persistence", "revisit"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Replace substrate"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "repository", "memory"],
    requiredEvidenceCategories: ["configuration_boundary"],
  },
});

export const auth: ScenarioFixture = withEvidence({
  name: "auth-boundary-requires-review-or-decision",
  event: {
    ...baseEvent,
    userRequest: "Add account login and session cookies",
    changedFiles: ["src/auth/session.ts", "src/pages/Login.tsx"],
  },
  evidence: [
    signal("auth", "configuration_boundary", "high", [
      "Session cookie authentication and account login are being added",
    ]),
  ],
  expectation: {
    requiredThresholds: ["identity", "security"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "repository"],
    requiredEvidenceCategories: ["configuration_boundary"],
  },
});

export const deployment: ScenarioFixture = withEvidence({
  name: "deployment-expectation-is-load-bearing",
  event: {
    ...baseEvent,
    userRequest: "Deploy this as a public hosted app",
    changedFiles: ["wrangler.toml", "src/index.ts"],
  },
  evidence: [
    signal("hosting", "configuration_boundary", "high", [
      "Cloudflare production deployment config for a public hosted app",
    ]),
  ],
  memory: [authShortcutDecision],
  expectation: {
    requiredThresholds: ["deployment"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision", "Run review"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "repository", "memory"],
    requiredEvidenceCategories: ["configuration_boundary"],
  },
});

export const broadDiff: ScenarioFixture = withEvidence({
  name: "broad-diff-exposes-blast-radius",
  event: {
    ...baseEvent,
    userRequest: "Wire saved projects through UI, API, storage, and deployment config",
    changedFiles: [
      "src/ui/Button.tsx",
      "src/api/projects.ts",
      "src/storage/projects.ts",
      "config/deploy.ts",
    ],
  },
  evidence: [
    signal("layout", "file_layout", "medium", [
      "React app with src/ui, src/api, src/storage, and config entrypoints",
    ]),
  ],
  expectation: {
    requiredThresholds: ["blast_radius"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "repository", "change"],
    requiredEvidenceCategories: ["file_layout", "changed_file_spread"],
  },
});

export const overengineeringRisk: ScenarioFixture = withEvidence({
  name: "weak-overengineering-signal-does-not-add-structure",
  event: {
    ...baseEvent,
    userRequest: "Add local button hover state",
  },
  evidence: [],
  expectation: {
    requiredThresholds: [],
    allowedInterventions: ["note"],
    expectedActions: ["Continue"],
    forbiddenActions: ["Replace substrate", "Insert boundary", "Run review"],
    requiredSignalFamilies: ["lifecycle"],
    requiredEvidenceCategories: [],
    expectedSilence: true,
  },
});

export const publicContract: ScenarioFixture = withEvidence({
  name: "public-api-contract-needs-decision",
  event: {
    ...baseEvent,
    userRequest: "Expose a public API endpoint for project imports",
    changedFiles: ["src/api/imports.ts", "openapi.yaml"],
  },
  evidence: [
    signal("api", "configuration_boundary", "high", [
      "Public API endpoint with request response contract in OpenAPI",
    ]),
  ],
  expectation: {
    requiredThresholds: ["public_api"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "repository"],
    requiredEvidenceCategories: ["configuration_boundary"],
  },
});

export const operationalEvidence: ScenarioFixture = withEvidence({
  name: "runtime-evidence-needs-operational-attention",
  event: {
    ...baseEvent,
    userRequest: "Add health checks for production import failures",
    changedFiles: ["src/health.ts", "src/metrics.ts"],
  },
  evidence: [
    signal("runtime-monitor", "runtime_error", "high", [
      "Production runtime error alert for project import failures",
    ]),
    signal("tests", "test_posture", "medium", [
      "Playwright smoke test covers health endpoint",
    ]),
  ],
  expectation: {
    requiredThresholds: ["operational"],
    allowedInterventions: ["recommend"],
    expectedActions: ["Record decision"],
    forbiddenActions: ["Continue"],
    requiredSignalFamilies: ["lifecycle", "runtime", "test"],
    requiredEvidenceCategories: ["runtime_error", "test_posture"],
  },
});

export const scenarioFixtures: ScenarioFixture[] = [
  simpleFirstFeature,
  repeatedState,
  persistence,
  expiredAssumption,
  auth,
  deployment,
  broadDiff,
  overengineeringRisk,
  publicContract,
  operationalEvidence,
];

function withEvidence(input: {
  name: string;
  event: CoachEventEnvelope;
  evidence: OptionalSignalResult[];
  memory?: ScenarioFixture["memory"];
  expectation: ScenarioFixture["expectation"];
}): ScenarioFixture {
  const event = {
    ...input.event,
    optionalSignals: input.evidence,
  };
  return {
    name: input.name,
    event,
    telemetry: telemetryFromEvidence({
      event,
      evidence: input.evidence,
      priorDecisions: input.memory,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: input.name,
    }),
    memory: input.memory ?? [],
    expectation: input.expectation,
  };
}

function signal(
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
