// Lesson 7.4: an MCP client. It starts a server, does the handshake, lists the server's
// tools and wraps each one as a Module 6 Tool. Your agent loop then runs any MCP
// server's tools without knowing MCP exists: the model sees ordinary tool definitions.

import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "../m04-embeddings/corpus";
import type { Tool } from "../m06-agents/tools";

// Servers by nickname. Anything else is taken as a command line.
export const SERVERS: Record<string, string[]> = {
  notes: ["npx", "tsx", "m07-mcp/notes-server.ts"],
  raw: ["npx", "tsx", "m07-mcp/raw-server.ts"],
  // Off the shelf, from the MCP project: file tools, limited to the folder you name.
  // Pinned (concept 7): a later release could change the tools and their descriptions.
  files: ["npx", "-y", "@modelcontextprotocol/server-filesystem@2.1.0", join(ROOT, "m06-agents", "sandbox")],
};

export type Connection = {
  server: string; // the name and version the server reported in the handshake
  capabilities: string[]; // what it declared: tools, resources, prompts…
  tools: Tool[];
  close: () => Promise<void>;
};

// options.env: environment variables this server needs, on top of the safe defaults
// (Module 8 passes the Slack server its token, and nothing else).
export async function connect(server: string, options: { env?: Record<string, string> } = {}): Promise<Connection> {
  const [command, ...args] = SERVERS[server] ?? server.split(" ");
  // Starts the server as a child process. Its stderr (its logs) shows up in your
  // terminal. By default only a few safe variables (PATH, HOME…) reach it, not your
  // whole environment with its API keys: least privilege.
  const transport = new StdioClientTransport({ command, args, cwd: ROOT, stderr: "inherit", env: options.env });
  const client = new Client({ name: "m07-mcp-agent", version: "1.0.0" });
  await client.connect(transport); // initialize → result → notifications/initialized

  const info = client.getServerVersion();
  const { tools } = await client.listTools();

  return {
    server: info ? `${info.name} ${info.version}` : "(unnamed)",
    capabilities: Object.keys(client.getServerCapabilities() ?? {}),
    tools: tools.map(
      (tool): Tool => ({
        name: tool.name,
        description: tool.description ?? "",
        // MCP allows any JSON Schema; Module 6's Tool type is narrower, so keep the outer shape.
        parameters: {
          type: "object",
          properties: (tool.inputSchema.properties ?? {}) as Tool["parameters"]["properties"],
          required: tool.inputSchema.required ?? [],
        },
        run: async (args) => {
          // tools/call. The first search may embed changed notes, so allow 5 minutes, not 1.
          const result = await client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: 300_000 });
          const parts = (result.content ?? []) as { type: string; text?: string }[];
          const text = parts.map((part) => (part.type === "text" ? part.text : `[${part.type} content]`)).join("\n");
          // A tool error is still a result, marked isError: hand it to the model the Module 6 way.
          return result.isError === true ? `Error: ${text}` : text;
        },
      }),
    ),
    close: () => client.close(), // ends the connection and stops the server
  };
}
