// Lesson 3.1: structured output. Asking for JSON vs. constraining the model to it.
//
// Run:  npx tsx m03-prompting-evals/extract.ts

import * as z from "zod";
import { ask, system, user } from "../common/llm";

// The shape we want. Zod describes it once and gives us two things: the JSON Schema
// to send to the model, and a validator to check what comes back.
const Ticket = z.object({
  customerName: z.string().nullable().describe("The customer's name, or null if they didn't give it"),
  orderId: z.string().nullable().describe("The order number, or null"),
  issue: z.enum(["damaged", "late", "wrong_item", "billing", "other"]),
  refundRequested: z.boolean(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});
const schema = z.toJSONSchema(Ticket);

const MESSAGES = [
  `hi,, my order 88-1932 came yesterday but the lamp is smashed to bits?? really disappointed. I want my money back. - Priya`,
  `Hello there! Quick one: the blue sweater I ordered (order no. A5512) turned out to be green. Not a big deal, can I swap it? Cheers, Tom`,
  `It's been THREE WEEKS. No package. No reply to my emails. This is the last time I order from you.`,
];

// Both runs get exactly the same instructions: the only difference is the constraint.
const INSTRUCTIONS =
  "Extract the details of this customer message. Reply with JSON only, with these fields: " +
  "customerName, orderId, issue (damaged, late, wrong_item, billing or other), " +
  "refundRequested (true or false), sentiment (positive, neutral or negative).";

console.log("The JSON Schema that Zod generates, sent with the constrained requests:");
console.log(JSON.stringify(schema, null, 2));

let askedValid = 0;
let constrainedValid = 0;

for (const message of MESSAGES) {
  console.log(`\n──── ${JSON.stringify(message.slice(0, 70))}… ────`);

  // A: ask nicely. The model may comply, add a sentence, or wrap the JSON in ``` fences.
  const asked = await ask([system(INSTRUCTIONS), user(message)]);
  askedValid += check("asked      ", asked.text);

  // B: constrain. The server only lets the model generate tokens that keep the output valid.
  const constrained = await ask([system(INSTRUCTIONS), user(message)], { schema });
  constrainedValid += check("constrained", constrained.text);
}

console.log(`\nValid and matching the schema: asked ${askedValid}/${MESSAGES.length}, constrained ${constrainedValid}/${MESSAGES.length}`);

// Parse and validate one output, and say what happened. Returns 1 if it's valid.
function check(label: string, text: string): number {
  console.log(`${label}  raw: ${text}`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`${label}  ✗ not valid JSON`);
    return 0;
  }

  const result = Ticket.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    console.log(`${label}  ✗ valid JSON, wrong shape: ${problems}`);
    return 0;
  }

  console.log(`${label}  ✓ ${JSON.stringify(result.data)}`);
  return 1;
}
