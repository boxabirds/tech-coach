import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessArchitecture,
  type AssessmentInput,
  type AssessmentResult,
} from "../../kernel/src/assessment.js";
import type {
  CoachEventEnvelope,
  InterventionLevel,
} from "../../kernel/src/protocol.js";
import type { BaselineQuestion } from "../../kernel/src/baselineTypes.js";
import {
  collectRepositoryTelemetry,
} from "../../persistence/src/index.js";
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
  env?: Record<string, string | undefined>;
};

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
    return withAudit(event, { effect: "none" });
  }

  if (event.kind === "SessionStart") {
    const context = (runtime.readMemoryContext ?? readDefaultMemoryContext)(event.cwd);
    return withAudit(
      event,
      context
        ? { effect: "inject", message: formatSessionContext(context) }
        : { effect: "none" },
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
        return withAudit(event, { effect: "none", message: gate.message });
      }
      return withAudit(event, {
        effect: "block",
        message: gate.message ?? gate.reason ?? "Resolve the architecture completion gate before stopping.",
      });
    }

    if (!shouldSurfaceAssessment(assessment)) {
      return withAudit(event, { effect: "none" });
    }

    const message = formatAssessmentSignpost(assessment);
    const canBlock = shouldBlock(assessment.intervention, config.mode);
    return withAudit(event, {
      effect: canBlock ? "block" : "inject",
      message,
      interviewRequired: assessment.questions.slice(0, 3),
    });
  } catch (error) {
    return withAudit(
      event,
      diagnosticResponse("Tech Lead lifecycle assessment failed.", error, config, event.kind),
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
  if (assessment.intervention === "silent" || assessment.action === "Continue") {
    return false;
  }
  if (assessment.revisitAlerts.length > 0 || assessment.questions.length > 0) {
    return true;
  }
  if (assessment.principleGuidance.some((guidance) => guidance.patterns.length > 0)) {
    return true;
  }
  if (assessment.evidence.some((item) => item.category === "risk_hotspot" || item.category === "changed_file_spread")) {
    return true;
  }
  return !nonActionableReasons.has(assessment.reason);
}

function shouldBlock(intervention: InterventionLevel, mode: CoachMode): boolean {
  if (intervention !== "block") {
    return false;
  }
  return mode === "balanced" || mode === "strict";
}

function formatAssessmentSignpost(assessment: AssessmentResult): string {
  const lines = [
    `Architecture signpost: ${assessment.action}.`,
    assessment.reason,
  ];

  const guidance = assessment.principleGuidance.find((item) => item.patterns.length > 0);
  const pattern = guidance?.patterns[0];
  if (pattern) {
    lines.push(`Add now: ${pattern.addNow}`);
    lines.push(`Do not add yet: ${pattern.doNotAddYet}`);
  } else if (assessment.doNotAdd.length > 0) {
    lines.push(`Do not add yet: ${assessment.doNotAdd[0]}`);
  }

  const evidence = assessment.evidence.slice(0, 3).map((item) => `- ${item.summary}`);
  if (evidence.length > 0) {
    lines.push("Evidence:");
    lines.push(...evidence);
  }

  const questions = assessment.questions.slice(0, 3);
  if (questions.length > 0) {
    lines.push("Ask the user before depending on this assumption:");
    for (const question of questions) {
      lines.push(`- [${question.id}] ${question.prompt}`);
    }
    lines.push("Preserve the question IDs and apply answers through the Tech Lead MCP tools.");
  }

  return lines.join("\n");
}

function formatSessionContext(context: string): string {
  const compact = context
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 12)
    .join("\n");
  return `Tech Lead architecture context:\n${compact}`;
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

function withAudit(event: ClaudeLifecycleEvent, response: HookResponse): HookResponse {
  return {
    ...response,
    audit: response.audit ?? {
      kind: event.kind,
      cwd: event.cwd,
      effect: response.effect,
      ...(response.message ? { reason: response.message.split("\n")[0] } : {}),
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
