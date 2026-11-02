// Lesson 3.2: compare prompts with an eval, not by feel.
//
// Run:  npx tsx m03-prompting-evals/eval-tickets.ts
//       npx tsx m03-prompting-evals/eval-tickets.ts --model llama3.2:3b    another Ollama model
//       npx tsx m03-prompting-evals/eval-tickets.ts --profile hf           a hosted model (see README)
//       add --verbose to see every output, not just the failures

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as z from "zod";
import { printReport, runEval, type EvalCase, type Variant } from "../common/evals";
import { ask, assistant, pickTarget, system, user } from "../common/llm";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    profile: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
const target = pickTarget(values);

const CATEGORIES = ["billing", "technical", "shipping", "account", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const cases: EvalCase<string, Category>[] = JSON.parse(readFileSync(new URL("./tickets.json", import.meta.url), "utf8"));

const DEFINITIONS = `You classify customer support tickets for an online shop into exactly one category:
- billing: charges, refunds, invoices, prices, discount codes
- technical: the website or app not working, errors, crashes, slowness
- shipping: delivery, tracking, delivery address, items damaged in transit
- account: logging in, passwords, two-factor codes, profile details, email address, deleting the account
- other: anything else, such as general questions, feedback or compliments`;

const ANSWER_ONLY = "Reply with the category name only, in lowercase.";

// Instructions first, the ticket last and inside tags. The instructions are identical
// for every ticket, so they stay cached, and the tags mark where the data starts and ends.
const ticketMessage = (ticket: string) => user(`<ticket>\n${ticket}\n</ticket>`);

// Few-shot examples, one per category. None of them is in tickets.json: examples that
// also appear in the eval would test memory, not skill.
const EXAMPLES: [string, Category][] = [
  ["My refund still hasn't appeared on my card after ten days.", "billing"],
  ["The search bar returns no results, whatever I type.", "technical"],
  ["Can I pick up my order from your warehouse instead of having it delivered?", "shipping"],
  ["How do I change the name on my profile?", "account"],
  ["Do you sell gift cards?", "other"],
];

const SCHEMA = z.toJSONSchema(z.object({ category: z.enum(CATEGORIES) }));

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

// Strict on purpose: after trimming, lowercasing and dropping punctuation, the answer
// must be exactly the category. Is "category: billing" wrong, or is this score too
// strict? Read the failures and decide (exercise 1).
const normalize = (text: string) => text.trim().toLowerCase().replace(/[.!*"'`]/g, "");
const score = (output: string, expected: Category) => (normalize(output) === expected ? 1 : 0);

console.log(`Model: ${target.model} · ${cases.length} tickets · ${variants.length} prompt variants\n`);
const results = await runEval({ cases, variants, score });
printReport(results, { verbose: values.verbose });
