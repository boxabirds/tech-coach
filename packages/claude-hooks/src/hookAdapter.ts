import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessArchitecture,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import {
  classifyUsageEvent,
  type UsageEventInput,
} from "../../kernel/src/usageEvents.js";
import type {
  CoachEventEnvelope,
  InterventionLevel,
} from "../../kernel/src/protocol.js";
import type { BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import {
  collectRepositoryTelemetry,
  openPersistenceStore,
  type StoreOptions,
} from "../../persistence/src/index.js";
import {
  buildLifecycleAuditRecord,
} from "../../persistence/src/lifecycle.js";
import type { LifecycleAuditRecord } from "../../persistence/src/types.js";
import type { ArchitecturalTelemetryBundle } from "../../kernel/src/telemetryTypes.js";
import { evaluateClaudeStopGate } from "./stopGate.js";

export type ClaudeLifecycleKind =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PostToolBatch"
  | "Stop";

export type CoachMode = "advisory" | "balanced" | "strict";

export type CoachModeConfig = {
  mode: CoachMode;
};

export type ClaudeLifecycleEvent = {
  kind: ClaudeLifecycleKind;
  cwd: string;
  sessionId?: string;
  transcriptPath?: string;
  userRequest?: string;
  changedFiles: string[];
  raw: Record<string, unknown>;
};

export type HookAuditRecord = {
  kind: ClaudeLifecycleKind;
  cwd: string;
  effect: HookResponse["effect"];
  mode?: CoachMode;
  action?: string;
  intervention?: InterventionLevel;
  evidence?: string[];
  questionIds?: string[];
  correlationId?: string;
  createdAt?: string;
  degraded?: boolean;
  reason?: string;
};

export type HookResponse = {
  effect: "none" | "inject" | "block";
  message?: string;
  interviewRequired?: BaselineQuestion[];
  audit?: HookAuditRecord;
};

export type ClaudeHookOutput = {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: ClaudeLifecycleKind;
    additionalContext?: string;
  };
};

export type HookRuntime = {
  now?: () => string;
  readMemoryContext?: (cwd: string) => string | undefined;
  collectTelemetry?: (event: ClaudeLifecycleEvent, now: string) => {
    event: CoachEventEnvelope;
    telemetry: ArchitecturalTelemetryBundle;
  };
  assess?: (input: AssessmentInput) => AssessmentResult;
  recordAudit?: (record: LifecycleAuditRecord) => void;
  recordUsage?: (record: UsageEventInput) => void;
  env?: Record<string, string | undefined>;
};

export function recordLifecycleAudit(
  record: LifecycleAuditRecord,
  storeOptions: StoreOptions = {},
): void {
  const store = openPersistenceStore(record.repoRoot, storeOptions);
  try {
    store.appendLifecycleAudit(record);
  } finally {
    store.close();
  }
}

export function recordUsageEvent(
  record: UsageEventInput,
  storeOptions: StoreOptions = {},
): void {
  const store = openPersistenceStore(record.repoRoot, storeOptions);
  try {
    store.appendUsageEvent(record);
  } finally {
    store.close();
  }
}

const supportedKinds = new Set<ClaudeLifecycleKind>([
  "SessionStart",
  "UserPromptSubmit",
  "PostToolBatch",
  "Stop",
]);

const nonActionableReasons = new Set([
  "Current evidence does not require adding structure yet.",
  "No concrete architecture evidence or prior decisions were available.",
]);

export function handleClaudeHookEvent(
  raw: unknown,
  config: CoachModeConfig = readConfigFromEnv(),
  runtime: HookRuntime = {},
): HookResponse {
  let event: ClaudeLifecycleEvent;
  try {
    event = normalizeClaudeLifecycleEvent(raw);
  } catch (error) {
    return diagnosticResponse("Malformed Tech Lead hook input.", error, config, "UserPromptSubmit");
  }

  const stopLoopGuardActive = isStopLoopGuardActive(event, runtime.env ?? process.env);
  if (event.kind === "Stop" && stopLoopGuardActive) {
    return finalizeResponse(event, { effect: "none", message: "Stop loop guard is already active." }, config, runtime, {
      now: runtime.now?.() ?? new Date().toISOString(),
    });
  }

  if (event.kind === "SessionStart") {
    const now = runtime.now?.() ?? new Date().toISOString();
    const context = (runtime.readMemoryContext ?? readDefaultMemoryContext)(event.cwd);
    return finalizeResponse(
      event,
      context
        ? { effect: "inject", message: formatSessionContext(context) }
        : { effect: "none" },
      config,
      runtime,
      { now },
    );
  }

  try {
    const now = runtime.now?.() ?? new Date().toISOString();
    const collected = (runtime.collectTelemetry ?? collectClaudeHookTelemetry)(event, now);
    const assessment = (runtime.assess ?? assessArchitecture)({
      event: collected.event,
      telemetry: collected.telemetry,
    });
    if (event.kind === "Stop") {
      const gate = evaluateClaudeStopGate({
        mode: config.mode,
        assessment,
        telemetry: collected.telemetry,
        loopGuardActive: stopLoopGuardActive,
      });
      if (gate.outcome === "finish" || gate.outcome === "note") {
        return finalizeResponse(event, { effect: "none", message: gate.message }, config, runtime, {
          now,
          assessment,
          telemetry: collected.telemetry,
        });
      }
      return finalizeResponse(event, {
        effect: "block",
        message: gate.message ?? gate.reason ?? "Resolve the architecture completion gate before stopping.",
      }, config, runtime, {
        now,
        assessment,
        telemetry: collected.telemetry,
      });
    }

    if (!shouldSurfaceAssessment(assessment)) {
      const followUp = followUpEngagementResponse(event);
      if (followUp) {
        return finalizeResponse(event, followUp, config, runtime, {
          now,
          assessment,
          telemetry: collected.telemetry,
        });
      }
      return finalizeResponse(event, { effect: "none" }, config, runtime, {
        now,
        assessment,
        telemetry: collected.telemetry,
      });
    }

    const message = formatAssessmentSignpost(assessment);
    return finalizeResponse(event, {
      effect: effectForAssessment(assessment.intervention, config.mode),
      message,
      interviewRequired: assessment.questions.slice(0, 3),
    }, config, runtime, {
      now,
      assessment,
      telemetry: collected.telemetry,
    });
  } catch (error) {
    return finalizeResponse(
      event,
      diagnosticResponse("Tech Lead lifecycle assessment failed.", error, config, event.kind),
      config,
      runtime,
      {
        now: runtime.now?.() ?? new Date().toISOString(),
        degraded: true,
      },
    );
  }
}

export function normalizeClaudeLifecycleEvent(raw: unknown): ClaudeLifecycleEvent {
  if (!isRecord(raw)) {
    throw new Error("hook input must be a JSON object");
  }
  const kind = readKind(raw);
  if (!supportedKinds.has(kind)) {
    throw new Error(`unsupported hook event ${kind}`);
  }
  const cwd = readString(raw.cwd) ?? readString(raw.working_directory);
  if (!cwd) {
    throw new Error("cwd is required");
  }
  const userRequest = readString(raw.prompt)
    ?? readString(raw.userPrompt)
    ?? readString(raw.user_request)
    ?? readPayloadPrompt(raw);
  return {
    kind,
    cwd: resolve(cwd),
    sessionId: readString(raw.session_id),
    transcriptPath: readString(raw.transcript_path),
    userRequest,
    changedFiles: readStringArray(raw.changed_files) ?? readStringArray(raw.changedFiles) ?? [],
    raw,
  };
}

export function renderClaudeHookOutput(
  kind: ClaudeLifecycleKind,
  response: HookResponse,
): string {
  if (response.effect === "none") {
    return "";
  }
  const output: ClaudeHookOutput = response.effect === "block"
    ? {
        decision: "block",
        reason: response.message ?? "Tech Lead blocked this lifecycle event.",
      }
    : {
        hookSpecificOutput: {
          hookEventName: kind,
          additionalContext: response.message,
        },
      };
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function readConfigFromEnv(env: Record<string, string | undefined> = process.env): CoachModeConfig {
  const raw = env.ARCHCOACH_MODE ?? env.CLAUDE_PLUGIN_OPTION_COACH_MODE ?? "advisory";
  return {
    mode: raw === "balanced" || raw === "strict" ? raw : "advisory",
  };
}

export function collectClaudeHookTelemetry(
  event: ClaudeLifecycleEvent,
  capturedAt: string,
): {
  event: CoachEventEnvelope;
  telemetry: ArchitecturalTelemetryBundle;
} {
  const collected = collectRepositoryTelemetry({
    repoRoot: event.cwd,
    request: event.userRequest ?? defaultRequestFor(event.kind),
    capturedAt,
    correlationId: event.sessionId ?? `${event.kind}-${capturedAt}`,
  });
  return {
    event: {
      ...collected.event,
      host: "claude-code",
      event: event.kind,
      ...(event.userRequest ? { userRequest: event.userRequest } : {}),
      changedFiles: Array.from(new Set([
        ...collected.event.changedFiles,
        ...event.changedFiles,
      ])).sort(),
    },
    telemetry: collected.telemetry,
  };
}

function shouldSurfaceAssessment(assessment: AssessmentResult): boolean {
  const hasTemporalNextActionBasis = assessment.interactionContext === "requested_next_action"
    && ((assessment.temporalBrief?.future.length ?? 0) > 0 || (assessment.temporalBrief?.past.length ?? 0) > 0);
  if (assessment.intervention === "silent" || (assessment.action === "Continue" && !hasTemporalNextActionBasis)) {
    return false;
  }
  if (assessment.revisitAlerts.length > 0 || assessment.questions.length > 0) {
    return true;
  }
  if (assessment.principleGuidance.some((guidance) => guidance.patterns.length > 0)) {
    return true;
  }
  if (hasTemporalNextActionBasis) {
    return true;
  }
  if (assessment.evidence.some((item) => item.category === "risk_hotspot" || item.category === "changed_file_spread")) {
    return true;
  }
  return !nonActionableReasons.has(assessment.reason);
}

export function isArchitectureRelevantPrompt(prompt: string | undefined): boolean {
  if (!prompt) {
    return false;
  }
  const text = prompt.toLowerCase();
  if (containsAny(text, [
    "architecture",
    "architectural",
    "how do i build",
    "how do i add",
    "how should i add",
    "how do i create",
    "how should i create",
    "how do i refactor",
    "how should i refactor",
    "local-only",
    "local only",
    "offline",
    "self-host",
    "self host",
    "on-prem",
    "on prem",
    "storage",
    "database",
    "sqlite",
    "d1",
    "auth",
    "authentication",
    "authorization",
    "permission",
    "role",
    "deploy",
    "deployment",
    "hosting",
    "public api",
    "api contract",
    "test strategy",
    "test harness",
    "runtime boundary",
    "package boundary",
    "state ownership",
    "custom hook",
    "separation of concerns",
  ])) {
    return true;
  }
  return /\b(add|create|build|refactor|replace|split|extract|move|deploy)\b.*\b(local|storage|database|auth|api|boundary|runtime|package|test|deploy|host|offline)\b/.test(text);
}

function followUpEngagementResponse(event: ClaudeLifecycleEvent): HookResponse | undefined {
  if (event.kind !== "UserPromptSubmit" || !isArchitectureRelevantPrompt(event.userRequest)) {
    return undefined;
  }
  if (!readDefaultMemoryContext(event.cwd)) {
    return undefined;
  }
  return {
    effect: "inject",
    message: [
      "You already have useful project context for this question. Use that context before answering so the advice is tied to what is actually in the repo.",
      "If you include technical detail, explain the practical point first, then name the supporting evidence or tool.",
      "Technical detail: call architecture.query_assessment_graph or architecture.get_assessment_node for relevant claims and evidence.",
      "Give a plain-English default recommendation first, then ask at most two follow-up intent questions if they would materially change the recommendation.",
    ].join("\n"),
  };
}

export function effectForAssessment(
  intervention: InterventionLevel,
  mode: CoachMode,
): HookResponse["effect"] {
  if (mode === "advisory") {
    return "inject";
  }
  if (intervention === "block") {
    return "block";
  }
  if (mode === "balanced" && intervention === "decision-required") {
    return "block";
  }
  if (
    mode === "strict"
    && (
      intervention === "recommend"
      || intervention === "interview-required"
      || intervention === "decision-required"
    )
  ) {
    return "block";
  }
  return "inject";
}

function formatAssessmentSignpost(assessment: AssessmentResult): string {
  const lines = [
    "This change looks like it needs a little architecture attention before you continue.",
    "",
    `Recommended move: ${assessment.action}.`,
    assessment.reason,
  ];

  const guidance = selectedGuidance(assessment);
  const pattern = selectedPattern(assessment, guidance);
  if (pattern) {
    lines.push("");
    lines.push(`What to add now: ${pattern.addNow}`);
    lines.push(`What to leave out for now: ${pattern.doNotAddYet}`);
  } else if (assessment.doNotAdd.length > 0) {
    lines.push("");
    lines.push(`What to leave out for now: ${assessment.doNotAdd[0]}`);
  }

  const temporal = temporalLines(assessment);
  if (temporal.length > 0) {
    lines.push("");
    lines.push("Time basis:");
    lines.push(...temporal);
  }

  const evidence = assessment.evidence.slice(0, 3).map((item) => `- ${item.summary}`);
  if (evidence.length > 0) {
    lines.push("");
    lines.push("What I noticed:");
    lines.push(...evidence);
  }

  const questions = assessment.questions.slice(0, 3);
  if (questions.length > 0) {
    lines.push("");
    lines.push("Ask the user before depending on this:");
    for (const question of questions) {
      lines.push(`- ${question.prompt}`);
    }
    lines.push("");
    lines.push("Technical detail: keep the structured question ids from interviewRequired for follow-up tool calls; do not print those ids to the user.");
  }

  return lines.join("\n");
}

function temporalLines(assessment: AssessmentResult): string[] {
  const brief = assessment.temporalBrief;
  if (!brief) {
    return [];
  }
  const lines: string[] = [];
  if (brief.future.length > 0) {
    lines.push(`- Future intent: ${brief.future[0]}`);
  }
  if (brief.current.length > 0) {
    lines.push(`- Current system: ${brief.current[0]}`);
  }
  if (brief.past.length > 0) {
    lines.push(`- Past context: ${brief.past[0]}`);
  }
  if (brief.uncertain.length > 0) {
    lines.push(`- Uncertain work: ${brief.uncertain[0]}`);
  }
  return lines.slice(0, 3);
}

function selectedGuidance(assessment: AssessmentResult): AssessmentResult["principleGuidance"][number] | undefined {
  const concern = assessment.policy?.selected.concern;
  if (!concern) {
    return undefined;
  }
  return assessment.principleGuidance.find((item) => item.concern === concern);
}

function selectedPattern(
  assessment: AssessmentResult,
  guidance: AssessmentResult["principleGuidance"][number] | undefined,
): AssessmentResult["principleGuidance"][number]["patterns"][number] | undefined {
  if (!guidance) {
    return undefined;
  }
  const patternId = assessment.policy?.selected.patternId;
  return patternId
    ? guidance.patterns.find((pattern) => pattern.pattern === patternId)
    : guidance.patterns[0];
}

function formatSessionContext(context: string): string {
  const compact = context
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 12)
    .join("\n");
  return `Here is the saved project context to use before answering:\n${compact}`;
}

function readDefaultMemoryContext(cwd: string): string | undefined {
  const candidates = [
    resolve(cwd, ".ceetrix", "tech-lead", "latest-assessment.md"),
    resolve(cwd, ".archcoach", "state.md"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    return undefined;
  }
  return readFileSync(path, "utf8");
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function diagnosticResponse(
  prefix: string,
  error: unknown,
  config: CoachModeConfig,
  kind: ClaudeLifecycleKind,
): HookResponse {
  if (config.mode === "advisory") {
    return { effect: "none" };
  }
  const message = `${prefix} ${error instanceof Error ? error.message : String(error)}`;
  return {
    effect: config.mode === "strict" ? "block" : "inject",
    message,
    audit: { kind, cwd: "", effect: config.mode === "strict" ? "block" : "inject", reason: message },
  };
}

function finalizeResponse(
  event: ClaudeLifecycleEvent,
  response: HookResponse,
  config: CoachModeConfig,
  runtime: HookRuntime,
  context: {
    now: string;
    assessment?: AssessmentResult;
    telemetry?: ArchitecturalTelemetryBundle;
    degraded?: boolean;
  },
): HookResponse {
  const auditRecord = buildLifecycleAuditRecord({
    kind: event.kind,
    repoRoot: event.cwd,
    mode: config.mode,
    effect: response.effect,
    createdAt: context.now,
    reason: response.message?.split("\n")[0],
    assessment: context.assessment,
    telemetry: context.telemetry,
    degraded: context.degraded,
  });
  try {
    runtime.recordAudit?.(auditRecord);
  } catch {
    // Hooks must never fail or loop because audit persistence is unavailable.
  }
  try {
    const usage = classifyUsageEvent({
      source: "hook",
      hookEffect: response.effect,
      architectureRelevant: isArchitectureRelevantPrompt(event.userRequest),
      baselineExists: Boolean(readDefaultMemoryContext(event.cwd)),
      error: context.degraded,
    });
    runtime.recordUsage?.({
      id: `usage-${auditRecord.auditId}`,
      occurredAt: auditRecord.createdAt,
      repoRoot: event.cwd,
      sessionId: event.sessionId,
      source: "hook",
      engagementType: usage.engagementType,
      outcome: usage.outcome,
      metadata: {
        ...usage.metadata,
        lifecycleKind: event.kind,
        mode: config.mode,
        effect: response.effect,
        ...(context.assessment?.action ? { action: context.assessment.action } : {}),
      },
    });
  } catch {
    // Usage logging is diagnostic only and must not affect the hook contract.
  }
  return {
    ...response,
    audit: {
      kind: event.kind,
      cwd: event.cwd,
      effect: response.effect,
      mode: config.mode,
      action: context.assessment?.action,
      intervention: context.assessment?.intervention,
      evidence: auditRecord.evidence,
      questionIds: auditRecord.questionIds,
      correlationId: auditRecord.correlationId,
      createdAt: auditRecord.createdAt,
      degraded: auditRecord.degraded,
      ...(auditRecord.reason ? { reason: auditRecord.reason } : {}),
    },
  };
}

function isStopLoopGuardActive(
  event: ClaudeLifecycleEvent,
  env: Record<string, string | undefined>,
): boolean {
  return env.ARCHCOACH_STOP_HOOK_ACTIVE === "1"
    || event.raw.archcoach_stop_hook_active === true
    || event.raw.stop_hook_active === true;
}

function defaultRequestFor(kind: ClaudeLifecycleKind): string {
  return kind === "PostToolBatch"
    ? "Assess the last implementation batch for architecture drift."
    : "Assess this Claude lifecycle event for architecture timing.";
}

function readKind(raw: Record<string, unknown>): ClaudeLifecycleKind {
  const value = readString(raw.hook_event_name)
    ?? readString(raw.kind)
    ?? readString(raw.event);
  if (!value) {
    throw new Error("hook_event_name is required");
  }
  return value as ClaudeLifecycleKind;
}

function readPayloadPrompt(raw: Record<string, unknown>): string | undefined {
  const payload = raw.payload;
  if (!isRecord(payload)) {
    return undefined;
  }
  return readString(payload.prompt);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
