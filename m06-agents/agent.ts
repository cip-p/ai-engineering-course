// Lessons 6.2–6.4: an agent with native tool calling.
//
// Run:  npx tsx m06-agents/agent.ts --task t01
//       npx tsx m06-agents/agent.ts --task t01 --show-tools
//       npx tsx m06-agents/agent.ts "your own question"
// Options:  --tools calculator,read_file   only these tools
//           --max-steps 8                  the most model calls before giving up
//           --show-tools                   print the tool definitions the model receives
//           --model / --profile            another Ollama model, or a hosted one (Module 3)

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { runAgent, toolDefinitions } from "./agent-loop";
import { pickTask, printEvent, printResult } from "./cli";
import { pickTools } from "./tools";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    task: { type: "string" },
    tools: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    "show-tools": { type: "boolean", default: false },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const task = pickTask(values.task, positionals, "m06-agents/agent.ts");
const tools = pickTools(values.tools);

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
