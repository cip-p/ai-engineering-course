// Lesson 7.1: an MCP server written by hand, with no SDK.
//
// MCP's stdio transport is only this: the host starts your program, writes JSON-RPC
// messages to its stdin, one per line, and reads the answers from its stdout, one per
// line. This server offers two of Module 6's tools. It's enough for the MCP Inspector,
// Claude Code or the SDK's client to use them.
//
// Run:  npx tsx m07-mcp/raw-server.ts < m07-mcp/hello.jsonl
//       npx @modelcontextprotocol/inspector npx tsx m07-mcp/raw-server.ts

import { createInterface } from "node:readline";
import { pickTools, runTool } from "../m06-agents/tools";

const TOOLS = pickTools("calculator,current_time");

// The protocol versions this server can speak, newest first.
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

// What arrives on stdin: a request (id + method), a notification (method, no id), or a response.
type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any };

// stdout carries the protocol and nothing else: a stray console.log would reach the
// client as a broken message. Everything meant for humans goes to stderr.
const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = (text: string) => console.error(`  [raw-server] ${text}`);

// A JSON-RPC error: the request itself failed, as opposed to a tool that ran and failed.
const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });

async function handle(method: string, params: any): Promise<object> {
  switch (method) {
    // The handshake. The client says which version it speaks and what it supports; the
    // server answers with a version both understand, and with its own capabilities. This
    // one declares tools only, so a client won't ask it for resources or prompts.
    case "initialize":
      return {
        protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "raw-server", version: "1.0.0" },
      };

    case "ping":
      return {};

    // Module 6's tool definitions, with `parameters` renamed to `inputSchema`.
    case "tools/list":
      return { tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) };

    case "tools/call": {
      if (!TOOLS.some((tool) => tool.name === params?.name)) throw rpcError(-32602, `Unknown tool: ${params?.name}`);
      const result = await runTool(TOOLS, params.name, JSON.stringify(params.arguments ?? {}));
      // A tool that ran and failed still answers with a result, marked isError, because
      // the model should read the error and try again (Module 6's "Error: …" results).
      return { content: [{ type: "text", text: result }], isError: result.startsWith("Error:") };
    }

    default:
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;

  let message: Message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    continue;
  }
  log(`← ${message.method ?? "a response"}${message.id === undefined ? " (notification: no reply)" : ` #${message.id}`}`);

  // A notification has no id, and gets no reply. "notifications/initialized" is the
  // client's last step of the handshake.
  if (message.id === undefined || !message.method) continue;

  try {
    send({ jsonrpc: "2.0", id: message.id, result: await handle(message.method, message.params) });
  } catch (error) {
    const { code = -32603, message: text } = error as Error & { code?: number };
    send({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  }
}
