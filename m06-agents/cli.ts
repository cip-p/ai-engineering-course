// Shared by the agent command-line scripts (react-from-text.ts, agent.ts, and Module 7's
// mcp-agent.ts): pick the task, and print every step of the agent as it happens.

import type { AgentEvent, AgentResult } from "./agent-loop";
import { loadTasks } from "./tasks";

// The question: either typed on the command line, or a task from tasks.json (--task t01).
// script is the path in the usage message, e.g. "m06-agents/agent.ts".
export function pickTask(taskId: string | undefined, positionals: string[], script: string): string {
  if (taskId) {
    const task = loadTasks().find((t) => t.id === taskId);
    if (!task) throw new Error(`No task "${taskId}" in tasks.json`);
    return task.input;
  }
  if (positionals[0]) return positionals[0];
  console.error(`Usage: npx tsx ${script} --task t01   or   npx tsx ${script} "your question"`);
  process.exit(1);
}

const indent = (text: string) => text.replace(/\n/g, "\n     ");
const shorten = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}… (+${text.length - max} characters)` : text);

// The trace printer: one block per model call and per tool call.
export function printEvent(event: AgentEvent) {
  if (event.kind === "model") {
    const time = `${event.tokensIn} tokens in, ${event.tokensOut} out · ${event.seconds.toFixed(1)} s`;
    console.log(`\n── step ${event.step} · model · ${time}`);
    if (event.text) console.log(`   ${indent(event.text)}`);
    for (const call of event.calls) console.log(`   → calls ${call.name} ${call.arguments}`);
    if (event.madeUp) console.log(`   ⚠ then wrote the tool's result itself, before any tool ran:\n     ${indent(shorten(event.madeUp))}`);
  } else if (event.kind === "tool") {
    console.log(`── tool ${event.call.name}${event.byCode ? " (called by your code)" : ""} · ${event.seconds.toFixed(1)} s`);
    // A search returns three long passages: shorten each one, so you see which came back.
    const parts = event.call.name === "search_notes" ? event.result.split(/\n\n(?=\[\d+\] )/) : [event.result];
    console.log(`   ${indent(parts.map((part) => shorten(part, parts.length > 1 ? 200 : 400)).join("\n"))}`);
  } else {
    console.log(`   ⚠ ${event.text}`);
  }
}

export function printResult(result: AgentResult) {
  const errors = result.toolCalls.filter((call) => call.result.startsWith("Error:")).length + result.formatErrors;
  console.log(`\nAnswer: ${result.answer ?? "(none: stopped by the step limit)"}`);
  console.log(
    `${result.modelCalls} model calls · ${result.toolCalls.length} tool calls · ${errors} errors · ${result.seconds.toFixed(1)} s`,
  );
}
