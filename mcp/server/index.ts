#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  invokeArchitectureTool,
  listArchitectureTools,
  type ArchitectureCoachToolName,
} from "../../packages/mcp/src/tools.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export async function handleMcpJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  try {
    switch (request.method) {
      case "initialize":
        return response(id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "tech-coach", version: "0.1.0" },
          capabilities: { tools: {} },
        });
      case "notifications/initialized":
        return null;
      case "tools/list":
        return response(id, {
          tools: listArchitectureTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
      case "tools/call": {
        const name = request.params?.name;
        if (typeof name !== "string") {
          return errorResponse(id, -32602, "tools/call requires params.name");
        }
        const result = invokeArchitectureTool(
          name as ArchitectureCoachToolName,
          request.params?.arguments ?? {},
          { cwd: process.cwd() },
        );
        return response(id, {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
          isError: !result.ok,
        });
      }
      default:
        return errorResponse(id, -32601, `Unsupported MCP method ${request.method ?? "unknown"}`);
    }
  } catch (error) {
    return errorResponse(
      id,
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function runStdioServer(): Promise<void> {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const response = await handleMcpJsonRpc(JSON.parse(line) as JsonRpcRequest);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

function response(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStdioServer();
}
