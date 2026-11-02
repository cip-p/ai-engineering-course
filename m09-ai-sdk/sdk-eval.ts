// Module 9 (framework), lesson 9.4: Module 6's eval (t01–t06), run by both loops on the same
// day and the same machine: your agent-loop.ts, and the AI SDK's ToolLoopAgent.
//
// Run:  npx tsx m09-ai-sdk/sdk-eval.ts               both loops, about 10 minutes on a CPU
//       npx tsx m09-ai-sdk/sdk-eval.ts --only sdk
// Options:  --max-steps 8, --model, --profile

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ask, pickEndpoint, pickTarget, user } from "../common/llm";
import { runAgent, type AgentResult } from "../m06-agents/agent-loop";
import { loadTasks, type Task } from "../m06-agents/tasks";
import { TOOLS } from "../m06-agents/tools";
import { runSdkAgent, toSdkTools } from "./sdk-loop";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const maxSteps = Number(values["max-steps"]);
const target = pickTarget(values);
const endpoint = pickEndpoint(values);
const sdkTools = toSdkTools(TOOLS);

const loops = [
  { name: "yours", run: (task: string) => runAgent(task, { target, maxSteps }) },
  { name: "sdk", run: (task: string) => runSdkAgent(task, { endpoint, tools: sdkTools, maxSteps }) },
].filter((loop) => !values.only || values.only.split(",").includes(loop.name));

const tasks = loadTasks().filter((task): task is Task & { expected: string[] } => task.expected !== null);

// A warm-up, not measured. Otherwise the first loop pays for loading the model into memory and
// for embedding changed notes, and looks slower than it is. Lesson 9.3's first run showed it:
// 22.6 s and 10.0 s for what took 7.3 s and 0.2 s once warm.
process.stdout.write("warming up (not measured)… ");
await TOOLS.find((tool) => tool.name === "search_notes")?.run({ query: "warm-up" });
await ask([user("Reply with OK.")], { target, maxTokens: 2 });
process.stdout.write("done\n");

// Correct if the answer contains every expected string, as in Module 6's agent-eval.ts.
function isCorrect(answer: string | null, expected: string[]): boolean {
  const text = (answer ?? "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  return expected.every((part) => text.includes(part.toLowerCase()));
}
const errorsIn = (result: AgentResult) => result.toolCalls.filter((call) => call.result.startsWith("Error:")).length;

type Row = { loop: string; task: Task; result: AgentResult; correct: boolean };
const rows: Row[] = [];

// One loop at a time, so its prompt stays in Ollama's prompt cache from task to task.
for (const loop of loops) {
  process.stdout.write(`${loop.name.padEnd(6)} `);
  for (const task of tasks) {
    const result = await loop.run(task.input);
    const correct = isCorrect(result.answer, task.expected);
    rows.push({ loop: loop.name, task, result, correct });
    process.stdout.write(correct ? "✓" : "✗");
  }
  process.stdout.write("\n");
}

console.log("\nid   loop    correct  model calls  errors     time   tools used");
for (const { loop, task, result, correct } of rows) {
  const used = result.toolCalls.map((call) => call.name).join(", ") || "(none)";
  const limit = result.stoppedBy === "step limit" ? "  ⚠ step limit" : "";
  console.log(
    `${task.id}  ${loop.padEnd(6)} ${(correct ? "✓" : "✗").padStart(8)} ${String(result.modelCalls).padStart(12)} ` +
      `${String(errorsIn(result)).padStart(7)} ${`${result.seconds.toFixed(1)} s`.padStart(8)}   ${used}${limit}`,
  );
}

console.log("");
for (const loop of loops) {
  const mine = rows.filter((row) => row.loop === loop.name);
  const average = (pick: (row: Row) => number) => (mine.reduce((sum, row) => sum + pick(row), 0) / mine.length).toFixed(1);
  console.log(
    `${loop.name.padEnd(6)} ${mine.filter((row) => row.correct).length}/${mine.length} correct · ` +
      `${average((row) => row.result.modelCalls)} model calls per task · ` +
      `${mine.reduce((sum, row) => sum + errorsIn(row.result), 0)} errors · ${average((row) => row.result.seconds)} s per task`,
  );
}

// Same answer from both loops? At temperature 0 with the same prompt, they should agree.
if (loops.length === 2) {
  const differ = tasks.filter((task) => {
    const [a, b] = rows.filter((row) => row.task.id === task.id);
    return (a.result.answer ?? "") !== (b.result.answer ?? "");
  });
  console.log(`\nTasks where the two loops' answers differ: ${differ.map((task) => task.id).join(", ") || "none"}`);
}

// What the SDK saves you writing: lines of code, without comments and blank lines. sdk-loop.ts
// also holds the adapter for Module 6's tools, and reuses Module 6's types instead of defining them.
const codeLines = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("//")).length;
console.log(`Lines of code: agent-loop.ts ${codeLines("../m06-agents/agent-loop.ts")}, sdk-loop.ts ${codeLines("./sdk-loop.ts")}`);
