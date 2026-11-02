// Lesson 3.3: instruct vs. thinking, or what test-time compute buys you.
//
// Needs the thinking build of Qwen3 4B:  ollama pull qwen3:4b
// Run:  npx tsx m03-prompting-evals/reasoning.ts                       several minutes on a CPU
//       npx tsx m03-prompting-evals/reasoning.ts --only instruct,cot   skip the slow thinking model
//       add --verbose to see every answer and the start of the model's thinking

import { parseArgs } from "node:util";
import { printReport, runEval, type EvalCase, type Variant } from "../common/evals";
import { ask, llm, system, user } from "../common/llm";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "thinking-model": { type: "string", default: "qwen3:4b" },
    verbose: { type: "boolean", default: false },
  },
});

// Small problems that need a few steps. The last one is a tokenization trap (Module 2).
const PROBLEMS: EvalCase<string, number>[] = [
  { id: "muffins", input: "A café sells coffee for $3 and muffins for $2. Ana buys 4 coffees and some muffins, and pays $20 in total. How many muffins did she buy?", expected: 4 },
  { id: "train", input: "A train leaves at 9:40 and arrives at 13:15 the same day. How many minutes does the journey take?", expected: 215 },
  { id: "apples", input: "I have twice as many apples as Ben. Ben has 3 more apples than Cara. Cara has 5 apples. How many apples do the three of us have in total?", expected: 29 },
  { id: "jacket", input: "A $80 jacket is discounted by 25%, then 10% sales tax is added to the discounted price. What is the final price in dollars?", expected: 66 },
  { id: "multiply", input: "What is 17 × 24?", expected: 408 },
  { id: "strawberry", input: "How many times does the letter r appear in the word strawberry?", expected: 3 },
];

const DIRECT = "Reply with only the final number, nothing else.";
const STEP_BY_STEP = "Think step by step. Then give the final answer on the last line, as a number only.";

const allVariants: Variant<string>[] = [
  // No room to reason: the answer has to come out in the first few tokens.
  { name: "instruct", run: (problem) => ask([system(DIRECT), user(problem)], { maxTokens: 50 }) },
  // Same model, but the prompt asks it to write its reasoning out first.
  { name: "cot", run: (problem) => ask([system(STEP_BY_STEP), user(problem)], { maxTokens: 600 }) },
  // The thinking build reasons by itself before answering, even when told to reply with a number only.
  {
    name: "thinking",
    run: (problem) =>
      ask([system(DIRECT), user(problem)], { target: { llm, model: values["thinking-model"] }, maxTokens: 1500 }),
  },
];
const variants = values.only ? allVariants.filter((v) => values.only!.split(",").includes(v.name)) : allVariants;

// The last number in the answer counts, so "The final price is $66." scores as 66.
function score(output: string, expected: number): number {
  const numbers = output.replace(/,/g, "").match(/-?\d+(\.\d+)?/g);
  return numbers && Number(numbers.at(-1)) === expected ? 1 : 0;
}

console.log(`${PROBLEMS.length} problems · variants: ${variants.map((v) => v.name).join(", ")}\n`);
const results = await runEval({ cases: PROBLEMS, variants, score });
printReport(results, { verbose: values.verbose });
