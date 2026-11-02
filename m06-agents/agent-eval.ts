// Lesson 6.5: measure the agents. Every task with an expected answer, run by both agents.
//
// Run:  npx tsx m06-agents/agent-eval.ts                  both agents, about 5–10 minutes on a CPU
//       npx tsx m06-agents/agent-eval.ts --only native    one agent
// Options:  --max-steps 8  --model / --profile

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { runAgent, type AgentResult } from "./agent-loop";
import { loadTasks, type Task } from "./tasks";
import { runTextAgent } from "./text-loop";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "max-steps": { type: "string", default: "8" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const options = { target: pickTarget(values), maxSteps: Number(values["max-steps"]) };

const agents = [
  { name: "native", run: (task: string) => runAgent(task, options) },
  { name: "text", run: (task: string) => runTextAgent(task, options) },
].filter((agent) => !values.only || values.only.split(",").includes(agent.name));

const tasks = loadTasks().filter((task): task is Task & { expected: string[] } => task.expected !== null);

// Correct if the answer contains every expected string, ignoring case and thousands separators.
function isCorrect(answer: string | null, expected: string[]): boolean {
  const text = (answer ?? "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  return expected.every((part) => text.includes(part.toLowerCase()));
}
const errorsIn = (result: AgentResult) =>
  result.toolCalls.filter((call) => call.result.startsWith("Error:")).length + result.formatErrors;

type Row = { agent: string; task: Task; result: AgentResult; correct: boolean };
const rows: Row[] = [];

// One agent at a time, so its system prompt and tool definitions stay in Ollama's prompt cache.
for (const agent of agents) {
  process.stdout.write(`${agent.name.padEnd(8)} `);
  for (const task of tasks) {
    const result = await agent.run(task.input);
    const correct = isCorrect(result.answer, task.expected);
    rows.push({ agent: agent.name, task, result, correct });
    process.stdout.write(correct ? "✓" : "✗");
  }
  process.stdout.write("\n");
}

console.log("\nid   agent    correct  model calls  errors     time   tools used");
for (const { agent, task, result, correct } of rows) {
  const used = result.toolCalls.map((call) => call.name).join(", ") || "(none)";
  const limit = result.stoppedBy === "step limit" ? "  ⚠ step limit" : "";
  console.log(
    `${task.id}  ${agent.padEnd(8)} ${(correct ? "✓" : "✗").padStart(7)} ${String(result.modelCalls).padStart(12)} ` +
      `${String(errorsIn(result)).padStart(7)} ${`${result.seconds.toFixed(1)} s`.padStart(8)}   ${used}${limit}`,
  );
}

console.log("");
for (const agent of agents) {
  const mine = rows.filter((row) => row.agent === agent.name);
  const average = (pick: (row: Row) => number) => (mine.reduce((sum, row) => sum + pick(row), 0) / mine.length).toFixed(1);
  console.log(
    `${agent.name.padEnd(8)} ${mine.filter((row) => row.correct).length}/${mine.length} correct · ` +
      `${average((row) => row.result.modelCalls)} model calls per task · ` +
      `${mine.reduce((sum, row) => sum + errorsIn(row.result), 0)} errors · ` +
      `${mine.filter((row) => row.result.stoppedBy === "step limit").length} step limits · ` +
      `${average((row) => row.result.seconds)} s per task`,
  );
}

// The numbers say how often; the answers say why. Read the failures.
const failures = rows.filter((row) => !row.correct);
if (failures.length > 0) {
  console.log("\nFailures (expected → answer):");
  for (const { agent, task, result } of failures) {
    const answer = (result.answer ?? "(none: stopped by the step limit)").replace(/\s+/g, " ");
    console.log(`  ${task.id} ${agent.padEnd(7)} ${JSON.stringify(task.expected)} → ${answer}`);
  }
}
