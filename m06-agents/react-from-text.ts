// Lesson 6.1: a ReAct agent from plain text, with no tool-calling API.
//
// Run:  npx tsx m06-agents/react-from-text.ts --task t01
//       npx tsx m06-agents/react-from-text.ts --task t01 --show-prompt
//       npx tsx m06-agents/react-from-text.ts --task t01 --no-stop
//       npx tsx m06-agents/react-from-text.ts "your own question"
// Options:  --tools calculator,read_file   only these tools
//           --max-steps 8                  the most model calls before giving up
//           --model / --profile            another Ollama model, or a hosted one (Module 3)

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { pickTask, printEvent, printResult } from "./cli";
import { runTextAgent, textAgentPrompt } from "./text-loop";
import { pickTools } from "./tools";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    task: { type: "string" },
    tools: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    "show-prompt": { type: "boolean", default: false },
    "no-stop": { type: "boolean", default: false },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const task = pickTask(values.task, positionals, "m06-agents/react-from-text.ts");
const tools = pickTools(values.tools);

if (values["show-prompt"]) console.log(`\n──── SYSTEM PROMPT ────\n${textAgentPrompt(tools)}`);
console.log(`\nTask: ${task}`);
console.log(`Tools: ${tools.map((t) => t.name).join(", ")}${values["no-stop"] ? " · no stop sequence" : ""}`);

const result = await runTextAgent(task, {
  target: pickTarget(values),
  tools,
  maxSteps: Number(values["max-steps"]),
  stop: !values["no-stop"],
  onEvent: printEvent,
});
printResult(result);
