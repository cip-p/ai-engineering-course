// Lessons 7.2–7.3: your course notes as an MCP server, built with the official SDK. The
// SDK does what raw-server.ts did by hand: JSON-RPC, the handshake, checking arguments.
// This server offers all three MCP primitives:
//   - a tool (search_notes): the MODEL decides when to call it;
//   - resources (one per document): the APP or the USER decides what to read;
//   - a prompt (quiz): a template the USER picks, e.g. as a slash command in Claude Code.
//
// A host starts it; you don't run it on its own:
//   npx @modelcontextprotocol/inspector npx tsx m07-mcp/notes-server.ts
//   claude mcp add notes -- "$PWD/node_modules/.bin/tsx" "$PWD/m07-mcp/notes-server.ts"
//   npx tsx m07-mcp/mcp-agent.ts --server notes --task t05

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { corpusFiles, ROOT } from "../m04-embeddings/corpus";
import { pickTools } from "../m06-agents/tools";

const server = new McpServer({ name: "notes", version: "1.0.0" });

// ─── Tool: Module 6's search_notes, unchanged, behind the protocol ───────────

const [searchNotes] = pickTools("search_notes");

server.registerTool(
  searchNotes.name,
  {
    title: "Search course notes",
    description: searchNotes.description,
    // The SDK turns this Zod schema into the JSON Schema clients see, and checks every call against it.
    inputSchema: { query: z.string().describe("What to search for") },
  },
  async ({ query }) => ({ content: [{ type: "text", text: await searchNotes.run({ query }) }] }),
);

// ─── Resources: every document of the corpus, by URI ─────────────────────────

for (const file of corpusFiles()) {
  const text = () => readFileSync(join(ROOT, file), "utf8");
  const uri = new URL(`notes://${file}`).href; // e.g. notes://m05-rag/README.md
  server.registerResource(
    file,
    uri,
    { title: text().match(/^# (.+)$/m)?.[1] ?? file, mimeType: "text/markdown" },
    // Read when a client asks, so an edited README is served as it is now.
    async () => ({ contents: [{ uri, mimeType: "text/markdown", text: text() }] }),
  );
}

// ─── Prompt: a template the user fills in ────────────────────────────────────

server.registerPrompt(
  "quiz",
  {
    title: "Quiz me",
    description: "Quiz the user on a topic from their AI engineering course notes.",
    argsSchema: { topic: z.string().describe('A module or a topic, e.g. "Module 4" or "chunking"') },
  },
  // A prompt only returns messages for the host to send. The server never calls a model.
  ({ topic }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Quiz me on ${topic}, using my AI engineering course notes. First use search_notes to find the material. ` +
            "Then ask me one question at a time and wait for my answer. After each answer, tell me what I got right " +
            "and what I missed, and name the section of the notes it comes from. Stop after 3 questions and give me a score.",
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
console.error("notes server: ready on stdio"); // stderr: stdout belongs to the protocol
