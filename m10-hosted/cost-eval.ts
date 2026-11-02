// Lesson 10.10: quality and cost, local against hosted, on Module 3's two tasks.
//
// Every model gets the same prompts: the 20 tickets (the `definitions` prompt) and the six
// reasoning problems (`cot`). For each request the provider reports how many tokens it
// read and wrote, and those tokens, at the provider's price, are the bill.
//
// Run:  npx tsx m10-hosted/cost-eval.ts --profile hf --models Qwen/Qwen3-4B-Instruct-2507:nscale,openai/gpt-oss-120b:groq
//       add --verbose to see every answer

import { parseArgs } from "node:util";
import { printReport, runEval, type Result } from "../common/evals";
import { ask, system, user } from "../common/llm";
import { PROBLEMS, STEP_BY_STEP, score as problemScore } from "../m03-prompting-evals/problems";
import { ANSWER_ONLY, DEFINITIONS, loadTickets, score as ticketScore, ticketMessage } from "../m03-prompting-evals/tickets";
import { dollars, priceOf, targets } from "./hosted";

const { values } = parseArgs({
  options: {
    profile: { type: "string" },
    models: { type: "string" },
    "no-local": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});
const list = targets({ ...values, local: !values["no-local"] });
const tickets = loadTickets();
// "openai/gpt-oss-120b:groq" → "gpt-oss-120b:groq", for the tables.
const short = (model: string, hosted: boolean) => (hosted ? model.split("/").at(-1)! : "local");

const results: Record<"tickets" | "problems", Result[]> = { tickets: [], problems: [] };
for (const target of list) {
  console.log(`\n${target.label}`);
  // Reasoning models spend output tokens on thinking first (Module 3), so the budget is
  // generous: a cut-off answer would measure the budget, not the model.
  const classify = (ticket: string) => ask([system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`), ticketMessage(ticket)], { target, maxTokens: 1000 });
  const reason = (problem: string) => ask([system(STEP_BY_STEP), user(problem)], { target, maxTokens: 2000 });
  results.tickets.push(...(await runEval({ cases: tickets, variants: [{ name: short(target.model, target.hosted), run: classify }], score: ticketScore })));
  results.problems.push(...(await runEval({ cases: PROBLEMS, variants: [{ name: short(target.model, target.hosted), run: reason }], score: problemScore })));
}

console.log("\n════ tickets ════");
printReport(results.tickets, { verbose: values.verbose });
console.log("\n════ problems ════");
printReport(results.problems, { verbose: values.verbose });

// The bill: tokens × price, per task, and scaled to 1,000 requests.
console.log(`\n${"model".padEnd(48)} ${"price in/out ($/M)".padStart(19)} ${"tickets: tokens in/out".padStart(23)} ${"per 1,000".padStart(10)} ${"problems: tokens in/out".padStart(24)} ${"per 1,000".padStart(10)}`);
for (const target of list) {
  const price = await priceOf(target);
  const cells = (["tickets", "problems"] as const).map((task) => {
    const rows = results[task].filter((r) => r.variant === short(target.model, target.hosted));
    const average = (pick: (r: Result) => number) => rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
    const tokensIn = average((r) => r.output.tokensIn ?? 0);
    const tokensOut = average((r) => r.output.tokensOut ?? 0);
    const perThousand = price ? (1000 * (tokensIn * price.input + tokensOut * price.output)) / 1e6 : undefined;
    return { tokens: `${tokensIn.toFixed(0)} / ${tokensOut.toFixed(0)}`, cost: perThousand === undefined ? "?" : target.hosted ? dollars(perThousand) : "your CPU" };
  });
  const priceText = !target.hosted ? "—" : price ? `${price.input} / ${price.output}` : "unknown";
  console.log(
    `${target.label.padEnd(48)} ${priceText.padStart(19)} ${cells[0].tokens.padStart(23)} ${cells[0].cost.padStart(10)} ${cells[1].tokens.padStart(24)} ${cells[1].cost.padStart(10)}`,
  );
}
console.log(`\nA "?" or "unknown" price: the provider isn't pinned (":cheapest") or doesn't publish prices. Add it to m10-hosted/prices.json.`);
