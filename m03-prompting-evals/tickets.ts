// The ticket task from lesson 3.2: the categories, the prompt pieces, the cases and the
// score. eval-tickets.ts compares prompts with them; Module 10's electives reuse them to
// compare quantizations, a finetuned model and hosted models on exactly the same task.

import { readFileSync } from "node:fs";
import * as z from "zod";
import type { EvalCase } from "../common/evals";
import { user } from "../common/llm";

export const CATEGORIES = ["billing", "technical", "shipping", "account", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const loadTickets = (): EvalCase<string, Category>[] =>
  JSON.parse(readFileSync(new URL("./tickets.json", import.meta.url), "utf8"));

export const DEFINITIONS = `You classify customer support tickets for an online shop into exactly one category:
- billing: charges, refunds, invoices, prices, discount codes
- technical: the website or app not working, errors, crashes, slowness
- shipping: delivery, tracking, delivery address, items damaged in transit
- account: logging in, passwords, two-factor codes, profile details, email address, deleting the account
- other: anything else, such as general questions, feedback or compliments`;

export const ANSWER_ONLY = "Reply with the category name only, in lowercase.";

// Instructions first, the ticket last and inside tags. The instructions are identical
// for every ticket, so they stay cached, and the tags mark where the data starts and ends.
export const ticketMessage = (ticket: string) => user(`<ticket>\n${ticket}\n</ticket>`);

// Few-shot examples, one per category. None of them is in tickets.json: examples that
// also appear in the eval would test memory, not skill.
export const EXAMPLES: [string, Category][] = [
  ["My refund still hasn't appeared on my card after ten days.", "billing"],
  ["The search bar returns no results, whatever I type.", "technical"],
  ["Can I pick up my order from your warehouse instead of having it delivered?", "shipping"],
  ["How do I change the name on my profile?", "account"],
  ["Do you sell gift cards?", "other"],
];

export const SCHEMA = z.toJSONSchema(z.object({ category: z.enum(CATEGORIES) }));

// Strict on purpose: after trimming, lowercasing and dropping punctuation, the answer
// must be exactly the category. Is "category: billing" wrong, or is this score too
// strict? Read the failures and decide (exercise 1).
export const normalize = (text: string) => text.trim().toLowerCase().replace(/[.!*"'`]/g, "");
export const score = (output: string, expected: Category) => (normalize(output) === expected ? 1 : 0);
