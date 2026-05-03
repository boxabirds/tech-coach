import { resolve } from "node:path";
import {
  handleClaudeHookEvent,
  readConfigFromEnv,
  renderClaudeHookOutput,
  type CoachModeConfig,
  type HookResponse,
  type HookRuntime,
} from "../../claude-hooks/src/hookAdapter.js";

export type CodexLifecycleKind =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "Stop";

export type CodexLifecycleEvent = {
  kind: CodexLifecycleKind;
  cwd: string;
  sessionId?: string;
  transcriptPath?: string;
  turnId?: string;
  userRequest?: string;
  changedFiles: string[];
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  stopHookActive?: boolean;
  raw: Record<string, unknown>;
};

export type CodexHookOutput = {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  suppressOutput?: boolean;
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: CodexLifecycleKind;
    additionalContext?: string;
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
    decision?: {
      behavior: "deny";
      message: string;
    };
  };
};

const supportedKinds = new Set<CodexLifecycleKind>([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
]);

export function handleCodexHookEvent(
  raw: unknown,
  config: CoachModeConfig = readCodexConfigFromEnv(),
  runtime: HookRuntime = {},
): HookResponse {
  const event = normalizeCodexLifecycleEvent(raw);
  if (event.kind === "PostToolUse") {
    return {
      effect: "none",
      audit: {
        kind: "PostToolBatch",
        cwd: event.cwd,
        mode: config.mode,
        effect: "none",
      },
    };
  }
  const claudeRaw = codexEventToClaudeRaw(event);
  const effectiveRuntime: HookRuntime = event.kind === "Stop" && event.stopHookActive
    ? {
        ...runtime,
        env: {
          ...process.env,
          ...(runtime.env ?? {}),
          ARCHCOACH_STOP_HOOK_ACTIVE: "1",
        },
      }
    : runtime;
  const response = handleClaudeHookEvent(claudeRaw, config, effectiveRuntime);
  return {
    ...response,
    audit: response.audit
      ? {
          ...response.audit,
          kind: response.audit.kind,
        }
      : response.audit,
  };
}

export function normalizeCodexLifecycleEvent(raw: unknown): CodexLifecycleEvent {
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
  return {
    kind,
    cwd: resolve(cwd),
    sessionId: readString(raw.session_id),
    transcriptPath: readString(raw.transcript_path),
    turnId: readString(raw.turn_id),
    userRequest: readString(raw.prompt) ?? readString(raw.userPrompt) ?? readString(raw.user_request),
    changedFiles: readStringArray(raw.changed_files) ?? readStringArray(raw.changedFiles) ?? [],
    toolName: readString(raw.tool_name),
    toolUseId: readString(raw.tool_use_id),
    toolInput: raw.tool_input,
    toolResponse: raw.tool_response,
    stopHookActive: typeof raw.stop_hook_active === "boolean" ? raw.stop_hook_active : undefined,
    raw,
  };
}

export function renderCodexHookOutput(
  kind: CodexLifecycleKind,
  response: HookResponse,
): string {
  if (response.effect === "none") {
    return kind === "Stop" ? `${JSON.stringify({ continue: true }, null, 2)}\n` : "";
  }
  const output: CodexHookOutput = response.effect === "block"
    ? renderCodexBlockOutput(kind, response.message)
    : {
        hookSpecificOutput: {
          hookEventName: kind,
          additionalContext: response.message,
        },
      };
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function readCodexConfigFromEnv(env: Record<string, string | undefined> = process.env): CoachModeConfig {
  const raw = env.ARCHCOACH_MODE ?? env.CODEX_TECH_LEAD_MODE ?? "advisory";
  return {
    mode: raw === "balanced" || raw === "strict" ? raw : "advisory",
  };
}

function codexEventToClaudeRaw(event: CodexLifecycleEvent): Record<string, unknown> {
  return {
    hook_event_name: mappedKindForSharedHook(event.kind),
    cwd: event.cwd,
    session_id: event.sessionId,
    transcript_path: event.transcriptPath,
    prompt: event.userRequest ?? promptForToolEvent(event),
    changed_files: event.changedFiles,
    tool_calls: event.toolName
      ? [{
          tool_name: event.toolName,
          tool_use_id: event.toolUseId,
          tool_input: event.toolInput,
          tool_response: event.toolResponse,
        }]
      : undefined,
  };
}

function mappedKindForSharedHook(kind: CodexLifecycleKind): string {
  switch (kind) {
    case "PreToolUse":
    case "PermissionRequest":
    case "PostToolUse":
      return "PostToolBatch";
    default:
      return kind;
  }
}

function promptForToolEvent(event: CodexLifecycleEvent): string | undefined {
  if (!event.toolName) {
    return undefined;
  }
  return `${event.kind}: ${event.toolName}`;
}

function renderCodexBlockOutput(
  kind: CodexLifecycleKind,
  message = "Tech Lead blocked this lifecycle event.",
): CodexHookOutput {
  if (kind === "PreToolUse") {
    return {
      hookSpecificOutput: {
        hookEventName: kind,
        permissionDecision: "deny",
        permissionDecisionReason: message,
      },
    };
  }
  if (kind === "PermissionRequest") {
    return {
      hookSpecificOutput: {
        hookEventName: kind,
        decision: {
          behavior: "deny",
          message,
        },
      },
    };
  }
  return {
    decision: "block",
    reason: message,
  };
}

function readKind(raw: Record<string, unknown>): CodexLifecycleKind {
  const value = readString(raw.hook_event_name) ?? readString(raw.kind) ?? readString(raw.event);
  return value as CodexLifecycleKind;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === "string") ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
