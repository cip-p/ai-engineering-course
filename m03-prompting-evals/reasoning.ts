// Lesson 3.3: instruct vs. thinking, or what test-time compute buys you.
//
// Needs the thinking build of Qwen3 4B:  ollama pull qwen3:4b
// Run:  npx tsx m03-prompting-evals/reasoning.ts                       several minutes on a CPU
//       npx tsx m03-prompting-evals/reasoning.ts --only instruct,cot   skip the slow thinking model
//       add --verbose to see every answer and the start of the model's thinking
//
// The problems, the two prompts and the score are in problems.ts.

import { parseArgs } from "node:util";
import { printReport, runEval, type Variant } from "../common/evals";
import { ask, llm, system, user } from "../common/llm";
import { DIRECT, PROBLEMS, STEP_BY_STEP, score } from "./problems";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "thinking-model": { type: "string", default: "qwen3:4b" },
    verbose: { type: "boolean", default: false },
  },
});

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

console.log(`${PROBLEMS.length} problems · variants: ${variants.map((v) => v.name).join(", ")}\n`);
const results = await runEval({ cases: PROBLEMS, variants, score });
printReport(results, { verbose: values.verbose });
