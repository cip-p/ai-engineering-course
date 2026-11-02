// The problems from lesson 3.3, their two prompts and their score. reasoning.ts runs them;
// Module 10's electives reuse them, to see whether quantization or a hosted model changes
// the reasoning.

import type { EvalCase } from "../common/evals";

// Small problems that need a few steps. The last one is a tokenization trap (Module 2).
export const PROBLEMS: EvalCase<string, number>[] = [
  { id: "muffins", input: "A café sells coffee for $3 and muffins for $2. Ana buys 4 coffees and some muffins, and pays $20 in total. How many muffins did she buy?", expected: 4 },
  { id: "train", input: "A train leaves at 9:40 and arrives at 13:15 the same day. How many minutes does the journey take?", expected: 215 },
  { id: "apples", input: "I have twice as many apples as Ben. Ben has 3 more apples than Cara. Cara has 5 apples. How many apples do the three of us have in total?", expected: 29 },
  { id: "jacket", input: "A $80 jacket is discounted by 25%, then 10% sales tax is added to the discounted price. What is the final price in dollars?", expected: 66 },
  { id: "multiply", input: "What is 17 × 24?", expected: 408 },
  { id: "strawberry", input: "How many times does the letter r appear in the word strawberry?", expected: 3 },
];

export const DIRECT = "Reply with only the final number, nothing else.";
export const STEP_BY_STEP = "Think step by step. Then give the final answer on the last line, as a number only.";

// The last number in the answer counts, so "The final price is $66." scores as 66.
export function score(output: string, expected: number): number {
  const numbers = output.replace(/,/g, "").match(/-?\d+(\.\d+)?/g);
  return numbers && Number(numbers.at(-1)) === expected ? 1 : 0;
}
