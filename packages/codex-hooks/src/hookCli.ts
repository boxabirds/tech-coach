#!/usr/bin/env bun
import {
  handleCodexHookEvent,
  readCodexConfigFromEnv,
  renderCodexHookOutput,
  type CodexLifecycleKind,
} from "./hookAdapter.js";
import {
  recordLifecycleAudit,
  recordUsageEvent,
} from "../../claude-hooks/src/hookAdapter.js";

export async function runCodexHookCli(
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  stderr: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): Promise<number> {
  const forcedKind = argv[0] as CodexLifecycleKind | undefined;
  const rawInput = await readAll(stdin);
  const parsed = rawInput.trim().length > 0 ? JSON.parse(rawInput) as Record<string, unknown> : {};
  const input = forcedKind
    ? { ...parsed, hook_event_name: parsed.hook_event_name ?? forcedKind }
    : parsed;
  try {
    const response = handleCodexHookEvent(input, readCodexConfigFromEnv(), {
      recordAudit: recordLifecycleAudit,
      recordUsage: recordUsageEvent,
    });
    const kind = (input.hook_event_name ?? forcedKind) as CodexLifecycleKind;
    stdout.write(renderCodexHookOutput(kind, response));
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function readAll(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(data));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexHookCli().then((code) => {
    process.exitCode = code;
  });
}
