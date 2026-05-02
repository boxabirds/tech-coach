import type { OptionalSignalResult } from "../../packages/signals/src/index.js";
import type { CoachEventEnvelope } from "../../packages/kernel/src/protocol.js";
import { telemetryFromEvidence } from "../../packages/kernel/src/telemetry.js";
import {
  authShortcutDecision,
  localStorageDecision,
} from "../../packages/kernel/src/__fixtures__/memory/scenarios.js";
import type { JourneyFixture, JourneyTurn } from "../../packages/evaluation/src/journeyRunner.js";

const baseEvent: CoachEventEnvelope = {
  host: "journey-fixture",
  event: "assessment",
  cwd: "/repo",
  recentRequests: [],
  changedFiles: [],
  repoSignals: { status: "absent" },
  memoryRefs: [],
  priorDecisions: [],
  optionalSignals: [],
};

export const prototypeToNamed: JourneyFixture = {
  name: "prototype-to-named-state-owner",
  initialMemory: [],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-prototype-1",
      event: {
        ...baseEvent,
        userRequest: "Rename the dashboard heading",
      },
      expected: {
        expectedIntervention: "silent",
        expectedAction: "Continue",
        expectedInterview: false,
        requiredSignalFamilies: ["lifecycle"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-prototype-2",
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
      expected: {
        expectedIntervention: "recommend",
        expectedAction: "Extract",
        expectedConcern: "state_ownership",
        expectedFromState: "Exploratory",
        expectedToState: "Exploratory",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "change"],
      },
    }),
  ],
};

export const localPersistenceToCollaboration: JourneyFixture = {
  name: "local-persistence-to-collaboration",
  initialMemory: [localStorageDecision],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-persistence-1",
      event: {
        ...baseEvent,
        userRequest: "Add project tags to saved projects",
        changedFiles: ["src/lib/projectStorage.ts"],
        priorDecisions: [localStorageDecision],
        memoryRefs: ["decision-localstorage-projects"],
      },
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage stores saved projects in localStorage while the feature is single-user",
        ]),
      ],
      expected: {
        expectedIntervention: "recommend",
        expectedAction: "Insert boundary",
        expectedConcern: "data_storage",
        expectedToState: "Revisit",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "repository", "memory"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-persistence-2",
      event: {
        ...baseEvent,
        userRequest: "Let teammates share saved projects across devices",
        recentRequests: ["Sync saved projects between devices"],
        changedFiles: ["src/lib/projectStorage.ts", "src/api/projects.ts"],
        priorDecisions: [localStorageDecision],
        memoryRefs: ["decision-localstorage-projects"],
      },
      evidence: [
        signal("storage", "configuration_boundary", "high", [
          "projectStorage currently stores saved projects in localStorage before sharing",
        ]),
      ],
      expected: {
        expectedIntervention: "decision-required",
        expectedAction: "Replace substrate",
        expectedConcern: "data_storage",
        expectedFromState: "Revisit",
        expectedToState: "Revisit",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "repository", "memory"],
      },
    }),
  ],
};

export const demoAuthToProduction: JourneyFixture = {
  name: "demo-auth-to-production",
  initialMemory: [authShortcutDecision],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-auth-1",
      event: {
        ...baseEvent,
        userRequest: "Keep the prototype local while demoing login screens",
        changedFiles: ["src/pages/Login.tsx"],
        priorDecisions: [authShortcutDecision],
        memoryRefs: ["decision-no-auth"],
      },
      evidence: [
        signal("auth", "configuration_boundary", "medium", [
          "Login screen is a local-only demo with no authentication backend",
        ]),
      ],
      expected: {
        expectedIntervention: "interview-required",
        expectedAction: "Run review",
        expectedConcern: "authentication",
        expectedToState: "Revisit",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "repository", "memory"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-auth-2",
      event: {
        ...baseEvent,
        userRequest: "Deploy this as a public hosted app for team access",
        changedFiles: ["wrangler.toml", "src/index.ts"],
        priorDecisions: [authShortcutDecision],
        memoryRefs: ["decision-no-auth"],
      },
      evidence: [
        signal("hosting", "configuration_boundary", "high", [
          "Cloudflare production deployment config for a public hosted app",
        ]),
      ],
      expected: {
        expectedIntervention: "decision-required",
        expectedAction: "Run review",
        expectedConcern: "authentication",
        expectedFromState: "Revisit",
        expectedToState: "Revisit",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "repository", "memory"],
      },
    }),
  ],
};

export const deploymentOperationalization: JourneyFixture = {
  name: "deployment-operationalization",
  initialMemory: [],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-ops-1",
      event: {
        ...baseEvent,
        userRequest: "Add private preview deployment config",
        changedFiles: ["wrangler.toml"],
      },
      evidence: [
        signal("hosting", "configuration_boundary", "medium", [
          "Cloudflare preview deployment config",
        ]),
      ],
      expected: {
        expectedIntervention: "interview-required",
        expectedAction: "Operationalize",
        expectedConcern: "deployment",
        expectedToState: "Owned",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "repository"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-ops-2",
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
      expected: {
        expectedIntervention: "recommend",
        expectedAction: "Operationalize",
        expectedConcern: "observability",
        expectedToState: "LoadBearing",
        expectedInterview: true,
        requiredSignalFamilies: ["lifecycle", "runtime", "test"],
      },
    }),
  ],
};

export const interviewRequiredThenAnswered: JourneyFixture = {
  name: "interview-required-then-answered",
  initialMemory: [],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-interview-1",
      event: {
        ...baseEvent,
        userRequest: "Save projects before we choose a storage model",
        changedFiles: ["src/lib/projectStorage.ts"],
      },
      evidence: [
        signal("storage-todo", "symbol_reference", "low", [
          "TODO maybe use localStorage before a shared database",
        ]),
      ],
      hostAnswers: [
        {
          questionId: "question-fact-data_storage-fact-data-storage",
          action: "confirm",
          value: "temporary local-only storage",
          answerId: "answer-local-storage-temporary",
        },
      ],
      expected: {
        expectedIntervention: "interview-required",
        expectedAction: "Insert boundary",
        expectedConcern: "data_storage",
        expectedToState: "Named",
        expectedInterview: true,
        expectedResolvedQuestionIds: ["question-fact-data_storage-fact-data-storage"],
        requiredSignalFamilies: ["lifecycle", "change"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-interview-2",
      event: {
        ...baseEvent,
        userRequest: "Rename the saved projects heading after that decision",
      },
      expected: {
        expectedIntervention: "silent",
        expectedAction: "Continue",
        expectedInterview: false,
        expectedResolvedQuestionIds: ["question-fact-data_storage-fact-data-storage"],
        requiredSignalFamilies: ["lifecycle"],
      },
    }),
  ],
};

export const cosmeticFalsePositiveControl: JourneyFixture = {
  name: "cosmetic-false-positive-control",
  initialMemory: [],
  turns: [
    turn({
      turn: 1,
      correlationId: "journey-cosmetic-1",
      event: {
        ...baseEvent,
        userRequest: "Rename the dashboard title",
      },
      expected: {
        expectedIntervention: "silent",
        expectedAction: "Continue",
        expectedInterview: false,
        requiredSignalFamilies: ["lifecycle"],
      },
    }),
    turn({
      turn: 2,
      correlationId: "journey-cosmetic-2",
      event: {
        ...baseEvent,
        userRequest: "Adjust the empty state copy",
      },
      expected: {
        expectedIntervention: "silent",
        expectedAction: "Continue",
        expectedInterview: false,
        requiredSignalFamilies: ["lifecycle"],
      },
    }),
  ],
};

export const journeyFixtures: JourneyFixture[] = [
  prototypeToNamed,
  localPersistenceToCollaboration,
  demoAuthToProduction,
  deploymentOperationalization,
  interviewRequiredThenAnswered,
  cosmeticFalsePositiveControl,
];

function turn(input: {
  turn: number;
  correlationId: string;
  event: CoachEventEnvelope;
  evidence?: OptionalSignalResult[];
  hostAnswers?: JourneyTurn["hostAnswers"];
  expected: JourneyTurn["expected"];
}): JourneyTurn {
  const evidence = input.evidence ?? [];
  const event = {
    ...input.event,
    optionalSignals: evidence,
  };
  return {
    turn: input.turn,
    event,
    correlationId: input.correlationId,
    telemetry: telemetryFromEvidence({
      event,
      evidence,
      priorDecisions: event.priorDecisions,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: input.correlationId,
    }),
    ...(input.hostAnswers ? { hostAnswers: input.hostAnswers } : {}),
    expected: input.expected,
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
