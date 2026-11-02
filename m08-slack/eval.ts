// Lesson 8.4: the bot's eval, offline. It's the same assistant bot.ts runs, on cases.json,
// with no Slack event and no reply. So you can change the prompt, the tools or the model and
// measure the effect before the bot answers anyone. Two parts, one per component:
//   1. the router alone, on every case with a "route": one short model call each;
//   2. the whole assistant, on every case with an "expected" answer: about a minute each.
//
// Run:  npx tsx m08-slack/eval.ts                         the default design (search-again)
//       npx tsx m08-slack/eval.ts --design agent-v1       an earlier design (lesson 8.5):
//                                                           agent-v1, agent, search-first, router, read-first
// Options:  --only s01,s02   --trace   --max-steps 6, --model, --profile   as in Module 6

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { printEvent } from "../m06-agents/cli";
import { createAssistant, modelCallsOf, pickDesign, secondsOf, type Reply } from "./assistant";
import { loadCases, type Case } from "./cases";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    trace: { type: "boolean", default: false },
    design: { type: "string" }, // default: DEFAULT_DESIGN in assistant.ts
    "max-steps": { type: "string", default: "6" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});

const all = loadCases().filter((c) => !values.only || values.only.split(",").includes(c.id));
const cases = all.filter((c): c is Case & { expected: string[] } => c.expected !== null);
const unwritten = all.length - cases.length;
if (unwritten > 0) console.log(`${unwritten} cases have no expected answer yet: the router is checked on them, but not the answer.`);

// Correct if the answer contains every expected string, ignoring case and thousands separators.
function isCorrect(answer: string | null, expected: string[]): boolean {
  const text = (answer ?? "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  return expected.every((part) => text.includes(part.toLowerCase()));
}

const assistant = await createAssistant({
  target: pickTarget(values),
  maxSteps: Number(values["max-steps"]),
  design: pickDesign(values.design),
});
console.log(`Tools: ${assistant.tools.map((t) => t.name).join(", ")} · design: ${assistant.design}\n`);

try {
  // ─── 1. The router alone ─────────────────────────────────────────────────────
  // A component eval, like Module 5 scoring retrieval apart from the answers. When an answer
  // is wrong, this says whether the question even went down the right route.
  const routed = all.filter((c) => c.route);
  if (assistant.routed && routed.length > 0) {
    console.log("Router");
    let right = 0;
    for (const evalCase of routed) {
      const decision = await assistant.route(evalCase.input);
      const ok = decision.name === evalCase.route;
      if (ok) right++;
      const miss = ok ? "" : `   (should be ${evalCase.route})`;
      console.log(`  ${evalCase.id.padEnd(8)} ${ok ? "✓" : "✗"} ${decision.name.padEnd(6)} ${decision.seconds.toFixed(1)} s${miss}`);
    }
    console.log(`  ${right}/${routed.length} routed right\n`);
  }

  // ─── 2. The whole assistant ──────────────────────────────────────────────────
  const rows: { evalCase: Case & { expected: string[] }; reply: Reply; correct: boolean }[] = [];
  for (const evalCase of cases) {
    if (values.trace) console.log(`\n════ ${evalCase.id}`);
    else process.stdout.write(`${evalCase.id} `);
    const reply = await assistant.ask(evalCase.input, evalCase.context, values.trace ? printEvent : undefined);
    const correct = isCorrect(reply.answer, evalCase.expected);
    rows.push({ evalCase, reply, correct });
    if (!values.trace) process.stdout.write(correct ? "✓\n" : "✗\n");
  }

  // "time" and "model calls" include the router and your code's search; "tools the model
  // called" doesn't include the search, which wasn't the model's choice.
  console.log("\nid       correct  route   model calls     time   tools the model called");
  for (const { evalCase, reply, correct } of rows) {
    const used = reply.result.toolCalls.map((call) => call.name).join(", ") || "(none)";
    const again = reply.retry ? "  + your code searched again" : "";
    const limit = reply.result.stoppedBy === "step limit" ? "  ⚠ step limit" : "";
    console.log(
      `${evalCase.id.padEnd(8)} ${(correct ? "✓" : "✗").padStart(7)}  ${(reply.route?.name ?? "-").padEnd(6)} ` +
        `${String(modelCallsOf(reply)).padStart(11)} ${`${secondsOf(reply).toFixed(1)} s`.padStart(8)}   ${used}${again}${limit}`,
    );
  }

  const right = rows.filter((row) => row.correct).length;
  const seconds = rows.reduce((total, row) => total + secondsOf(row.reply), 0) / Math.max(1, rows.length);
  console.log(`\n${right}/${rows.length} correct · ${seconds.toFixed(1)} s per case`);

  const failures = rows.filter((row) => !row.correct);
  if (failures.length > 0) {
    console.log("\nFailures (expected → answer):");
    for (const { evalCase, reply } of failures) {
      console.log(`  ${evalCase.id} ${JSON.stringify(evalCase.expected)} → ${(reply.answer ?? "(none: step limit)").replace(/\s+/g, " ")}`);
    }
  }
} finally {
  await assistant.close();
}
