// Lesson 7.4: your Module 6 agent, with its tools from an MCP server.
//
// Run:  npx tsx m07-mcp/mcp-agent.ts --server notes --task t05
//       npx tsx m07-mcp/mcp-agent.ts --server files --task t03 --show-tools
//       npx tsx m07-mcp/mcp-agent.ts --server "npx tsx m07-mcp/raw-server.ts" "your question"
// Options:  --server notes | raw | files | "any command line"   (default: notes)
//           --tools a,b        only these of the server's tools
//           --show-tools       print the tool definitions the model receives
//           --max-steps 8, --model, --profile   as in Module 6

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { runAgent, toolDefinitions } from "../m06-agents/agent-loop";
import { pickTask, printEvent, printResult } from "../m06-agents/cli";
import { pickTools } from "../m06-agents/tools";
import { connect } from "./mcp-tools";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string", default: "notes" },
    task: { type: "string" },
    tools: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    "show-tools": { type: "boolean", default: false },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const task = pickTask(values.task, positionals, "m07-mcp/mcp-agent.ts");

const connection = await connect(values.server);
try {
  const tools = pickTools(values.tools, connection.tools);
  console.log(`\nServer: ${connection.server} · declares: ${connection.capabilities.join(", ")}`);
  console.log(`It offers ${connection.tools.length} tools: ${connection.tools.map((t) => t.name).join(", ")}`);

  if (values["show-tools"]) console.log(`\n──── TOOL DEFINITIONS ────\n${JSON.stringify(toolDefinitions(tools), null, 2)}`);
  console.log(`\nTask: ${task}`);
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

  const result = await runAgent(task, {
    target: pickTarget(values),
    tools,
    maxSteps: Number(values["max-steps"]),
    onEvent: printEvent,
  });
  printResult(result);
} finally {
  await connection.close();
}
