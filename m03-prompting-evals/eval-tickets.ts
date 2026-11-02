// Lesson 3.2: compare prompts with an eval, not by feel.
//
// Run:  npx tsx m03-prompting-evals/eval-tickets.ts
//       npx tsx m03-prompting-evals/eval-tickets.ts --model llama3.2:3b    another Ollama model
//       npx tsx m03-prompting-evals/eval-tickets.ts --profile hf           a hosted model (see README)
//       add --verbose to see every output, not just the failures
//
// The prompt pieces (DEFINITIONS, EXAMPLES, …) and the score are in tickets.ts.

import { parseArgs } from "node:util";
import { printReport, runEval, type Variant } from "../common/evals";
import { ask, assistant, pickTarget, system, user } from "../common/llm";
import { ANSWER_ONLY, DEFINITIONS, EXAMPLES, SCHEMA, loadTickets, score, ticketMessage } from "./tickets";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    profile: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
const target = pickTarget(values);

const cases = loadTickets();

const variants: Variant<string>[] = [
  {
    name: "bare",
    run: (ticket) =>
      ask([user(`Classify this support ticket as billing, technical, shipping, account or other.\n\n${ticket}`)], { target }),
  },
  {
    name: "definitions",
    run: (ticket) => ask([system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`), ticketMessage(ticket)], { target }),
  },
  {
    name: "few-shot",
    // The examples are written as earlier turns of the conversation: the model sees
    // itself having answered them correctly, and copies the pattern.
    run: (ticket) =>
      ask(
        [
          system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`),
          ...EXAMPLES.flatMap(([example, category]) => [ticketMessage(example), assistant(category)]),
          ticketMessage(ticket),
        ],
        { target },
      ),
  },
  {
    name: "structured",
    run: async (ticket) => {
      const output = await ask([system(`${DEFINITIONS}\n\nReply in JSON.`), ticketMessage(ticket)], { target, schema: SCHEMA });
      return { ...output, text: JSON.parse(output.text).category };
    },
  },
];

console.log(`Model: ${target.model} · ${cases.length} tickets · ${variants.length} prompt variants\n`);
const results = await runEval({ cases, variants, score });
printReport(results, { verbose: values.verbose });
