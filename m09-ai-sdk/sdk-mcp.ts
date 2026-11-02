// Module 9 (framework), lesson 9.5: MCP through the AI SDK. Its MCP client does what Module 7's
// mcp-tools.ts did by hand: start the server, do the handshake, turn the tools into tools the
// loop can call. It adds one thing you didn't build: pinning. The first run records a
// fingerprint of every tool's definition (name, description, input schema). Later runs refuse
// to start if a definition changed, which is how tool poisoning by an update (Module 7) gets caught.
//
// Run:  npx tsx m09-ai-sdk/sdk-mcp.ts --task t05
//       npx tsx m09-ai-sdk/sdk-mcp.ts --server files --task t03 --tools list_allowed_directories,list_directory,read_text_file
// Options:  --server notes | files | raw | "any command line"   (default: notes)
//           --repin       accept the server's current definitions as the new pins
//           --max-steps 8, --model, --profile

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { detectToolDrift, fingerprintTools, type ToolSet } from "ai";
import { pickEndpoint } from "../common/llm";
import { ROOT } from "../m04-embeddings/corpus";
import { pickTask, printEvent, printResult } from "../m06-agents/cli";
import { SERVERS } from "../m07-mcp/mcp-tools";
import { runSdkAgent } from "./sdk-loop";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string", default: "notes" },
    task: { type: "string" },
    tools: { type: "string" },
    repin: { type: "boolean", default: false },
    "max-steps": { type: "string", default: "8" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const task = pickTask(values.task, positionals, "m09-ai-sdk/sdk-mcp.ts");

const [command, ...args] = SERVERS[values.server] ?? values.server.split(" ");
const client = await createMCPClient({ transport: new StdioMCPTransport({ command, args, cwd: ROOT, stderr: "inherit" }) });

// The pins live in .cache/ (gitignored), one set per server.
const PINS = join(ROOT, ".cache", "tool-pins.json");

try {
  const offered = await client.tools();
  console.log(`\nServer: ${values.server} · it offers ${Object.keys(offered).length} tools: ${Object.keys(offered).join(", ")}`);

  const pins: Record<string, Record<string, string>> = existsSync(PINS) ? JSON.parse(readFileSync(PINS, "utf8")) : {};
  const current = await fingerprintTools(offered);
  const baseline = pins[values.server];
  let trusted = true;

  if (!baseline || values.repin) {
    pins[values.server] = current;
    mkdirSync(dirname(PINS), { recursive: true });
    writeFileSync(PINS, `${JSON.stringify(pins, null, 2)}\n`);
    console.log(`Pinned the definitions of ${Object.keys(current).length} tools. From now on, a change to any of them stops this script.`);
  } else {
    const drift = detectToolDrift(current, baseline);
    if (drift.changed.length > 0 || drift.added.length > 0) {
      trusted = false;
      console.error(
        `\nThe server's tools changed since you pinned them.` +
          `\n  changed: ${drift.changed.join(", ") || "none"}\n  added: ${drift.added.join(", ") || "none"}` +
          `\nRead the new definitions before the model does, then rerun with --repin if you accept them.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`The tool definitions match your pins.${drift.removed.length ? ` Removed since: ${drift.removed.join(", ")}` : ""}`);
    }
  }

  if (trusted) {
    // Least privilege, as in Module 7: only the tools you name.
    const names = values.tools?.split(",").map((name) => name.trim());
    const tools: ToolSet = names
      ? Object.fromEntries(
          names.map((name) => {
            if (!offered[name]) throw new Error(`No tool named "${name}". Tools: ${Object.keys(offered).join(", ")}`);
            return [name, offered[name]];
          }),
        )
      : offered;

    console.log(`\nTask: ${task}\nTools: ${Object.keys(tools).join(", ")}`);
    const result = await runSdkAgent(task, { endpoint: pickEndpoint(values), tools, maxSteps: Number(values["max-steps"]), onEvent: printEvent });
    printResult(result);
  }
} finally {
  await client.close(); // ends the connection and stops the server
}
