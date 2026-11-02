// Lesson 10.3: the finetuned 0.6B model against prompting, measured.
//
// Two sets of tickets: Module 3's 20 (written by a person, the real test), and the
// validation tickets from lesson 10.1 (generated like the training data, but never trained
// on). Six variants: the base 0.6B model with Module 3's three prompts, the finetuned
// 0.6B with no instructions at all, and the course's 4B model with two prompts.
//
// Needs both 0.6B models in Ollama (lesson 10.3):
//   ollama create tickets-0.6b -f .cache/finetune/tickets-0.6b/Modelfile
//   ollama create base-0.6b -f .cache/finetune/base-0.6b/Modelfile
//
// Run:  npx tsx m10-finetune/ft-eval.ts                         about 7 minutes on a CPU
//       npx tsx m10-finetune/ft-eval.ts --tuned tickets-50       another finetuned model (exercise 1)
//       add --verbose to see every answer

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { printReport, runEval, type EvalCase, type Result, type Variant } from "../common/evals";
import { ask, assistant, config, llm, system, user, type Target } from "../common/llm";
import { ANSWER_ONLY, DEFINITIONS, EXAMPLES, loadTickets, score, ticketMessage, type Category } from "../m03-prompting-evals/tickets";

const { values } = parseArgs({
  options: {
    tuned: { type: "string", default: "tickets-0.6b" },
    base: { type: "string", default: "base-0.6b" },
    verbose: { type: "boolean", default: false },
  },
});
const base: Target = { llm, model: values.base };
const tuned: Target = { llm, model: values.tuned };
const big: Target = { llm, model: config.model };

// The validation tickets, back from the training format into eval cases.
const validation: EvalCase<string, Category>[] = readFileSync(new URL("./data/tickets-valid.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line, i) => {
    const [question, answer] = JSON.parse(line).messages;
    return { id: `v${String(i + 1).padStart(2, "0")}`, input: question.content.replace(/^<ticket>\n|\n<\/ticket>$/g, ""), expected: answer.content };
  });

const bare = (ticket: string) => [user(`Classify this support ticket as billing, technical, shipping, account or other.\n\n${ticket}`)];
const definitions = (ticket: string) => [system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`), ticketMessage(ticket)];
const fewShot = (ticket: string) => [
  system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`),
  ...EXAMPLES.flatMap(([example, category]) => [ticketMessage(example), assistant(category)]),
  ticketMessage(ticket),
];

// Grouped by model, so each one loads once.
const variants: Variant<string>[] = [
  { name: "0.6b bare", run: (t) => ask(bare(t), { target: base, maxTokens: 20 }) },
  { name: "0.6b defs", run: (t) => ask(definitions(t), { target: base, maxTokens: 20 }) },
  { name: "0.6b few-shot", run: (t) => ask(fewShot(t), { target: base, maxTokens: 20 }) },
  // The finetuned model gets the ticket and nothing else: the instructions are in its weights now.
  { name: "0.6b tuned", run: (t) => ask([ticketMessage(t)], { target: tuned, maxTokens: 20 }) },
  { name: "4b defs", run: (t) => ask(definitions(t), { target: big, maxTokens: 20 }) },
  { name: "4b few-shot", run: (t) => ask(fewShot(t), { target: big, maxTokens: 20 }) },
];

const sets = { "Module 3's tickets": loadTickets(), "validation tickets (synthetic)": validation };
const all: Record<string, Result[]> = {};
for (const [name, cases] of Object.entries(sets)) {
  console.log(`\n${name}: ${cases.length}`);
  all[name] = await runEval({ cases, variants, score });
}

for (const [name, results] of Object.entries(all)) {
  console.log(`\n════ ${name} ════`);
  printReport(results, { verbose: values.verbose });
}

// What each variant sends: the finetuned model's prompt is just the ticket.
console.log(`\n${"variant".padEnd(14)} ${"tokens in".padStart(10)}   (average prompt, Module 3's tickets)`);
for (const variant of variants) {
  const rows = all["Module 3's tickets"].filter((r) => r.variant === variant.name);
  const average = rows.reduce((sum, r) => sum + (r.output.tokensIn ?? 0), 0) / rows.length;
  console.log(`${variant.name.padEnd(14)} ${average.toFixed(0).padStart(10)}`);
}
