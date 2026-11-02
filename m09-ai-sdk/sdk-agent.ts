// Module 9 (framework), lesson 9.3: Module 6's agent.ts, on the AI SDK. Same tools, same
// instructions, same step limit, same trace.
//
// Run:  npx tsx m09-ai-sdk/sdk-agent.ts --task t05
//       npx tsx m09-ai-sdk/sdk-agent.ts --task t01 --show-request
// Options:  --tools calculator,read_file   --max-steps 8   --show-request   --model / --profile

import { parseArgs } from "node:util";
import { pickEndpoint } from "../common/llm";
import { pickTask, printEvent, printResult } from "../m06-agents/cli";
import { pickTools } from "../m06-agents/tools";
import { runSdkAgent, toSdkTools } from "./sdk-loop";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    task: { type: "string" },
    tools: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    "show-request": { type: "boolean", default: false },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const task = pickTask(values.task, positionals, "m09-ai-sdk/sdk-agent.ts");
const tools = pickTools(values.tools);

console.log(`\nTask: ${task}`);
console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

const result = await runSdkAgent(task, {
  endpoint: pickEndpoint(values),
  tools: toSdkTools(tools),
  maxSteps: Number(values["max-steps"]),
  onEvent: printEvent,
  showRequests: values["show-request"],
});
printResult(result);
