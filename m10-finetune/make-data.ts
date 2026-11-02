// Lesson 10.1: build a training set for Module 3's ticket task, with AI-generated data.
//
// Four steps, each one printed with its numbers:
//   1. generate   the course model writes tickets for a given category, in different styles
//   2. verify     the same model classifies each ticket again; disagreements are dropped
//   3. dedupe     near-duplicates (by embedding similarity) are dropped
//   4. decontaminate  anything too close to one of Module 3's 20 eval tickets is dropped
// Then it splits what's left into a training set and a validation set.
//
// The result is already in data/, so you can skip this and go straight to lesson 10.2.
// Run it to see the process, or to make your own set (it overwrites the two files).
//
// Run:  npx tsx m10-finetune/make-data.ts                about an hour on a CPU
//       npx tsx m10-finetune/make-data.ts --per-call 3   a smaller set, faster

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as z from "zod";
import { ask, assistant, embed, system, user } from "../common/llm";
import { cosine } from "../m04-embeddings/vectors";
import { ANSWER_ONLY, CATEGORIES, DEFINITIONS, EXAMPLES, loadTickets, normalize, ticketMessage, type Category } from "../m03-prompting-evals/tickets";

const { values } = parseArgs({
  options: {
    "per-call": { type: "string", default: "6" },
    duplicate: { type: "string", default: "0.95" }, // two generated tickets this similar count as one
    contaminated: { type: "string", default: "0.90" }, // a generated ticket this close to an eval ticket is dropped
  },
});
const perCall = Number(values["per-call"]);

// The styles push the model away from writing the same ticket over and over.
const STYLES = [
  "short and to the point, a single sentence",
  "polite and detailed, three or four sentences",
  "angry, with exclamation marks",
  "casual, all lowercase, with a typo or two",
  "written in Spanish, French or German",
  "sarcastic",
  "mentions an order number and a product",
  "vague: the customer isn't sure what the problem is",
];

// Each category's definition, from Module 3's prompt ("- billing: charges, refunds, …").
const definitionOf = Object.fromEntries(
  DEFINITIONS.split("\n").flatMap((line) => {
    const match = line.match(/^- (\w+): (.+)$/);
    return match ? [[match[1], match[2]]] : [];
  }),
) as Record<Category, string>;

const Batch = z.object({ tickets: z.array(z.string()).min(perCall).max(perCall) });
const BATCH_SCHEMA = z.toJSONSchema(Batch);

type Ticket = { text: string; category: Category; style: string };

// ─── 1. Generate ─────────────────────────────────────────────────────────────

console.log(`1. Generating ${CATEGORIES.length} categories × ${STYLES.length} styles × ${perCall} tickets`);
const generated: Ticket[] = [];
for (const category of CATEGORIES) {
  process.stdout.write(`   ${category.padEnd(10)} `);
  for (const style of STYLES) {
    const prompt =
      `Write ${perCall} different support tickets that customers of an online shop could send. ` +
      `Every ticket must be about ${category}: ${definitionOf[category]}.\n` +
      `Style: ${style}.\n` +
      `Vary the products, the details and the length. Write only what the customer would type into the ` +
      `support form, and never name the category. Reply in JSON.`;
    try {
      // A high temperature for variety: here we want different answers on every call.
      const { text } = await ask([system("You write realistic test data."), user(prompt)], { schema: BATCH_SCHEMA, temperature: 1, maxTokens: 1200 });
      for (const ticket of Batch.parse(JSON.parse(text)).tickets) generated.push({ text: ticket.trim(), category, style });
      process.stdout.write("·");
    } catch {
      process.stdout.write("✗"); // a batch that didn't parse is skipped
    }
  }
  console.log();
}
console.log(`   ${generated.length} tickets\n`);

// ─── 2. Verify ───────────────────────────────────────────────────────────────

// The generator was asked for a category, but did it write one? Classify every ticket
// again with Module 3's few-shot prompt, and keep only those where the two agree.
console.log("2. Verifying: classifying every ticket again");
const fewShot = (ticket: string) => [
  system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`),
  ...EXAMPLES.flatMap(([example, category]) => [ticketMessage(example), assistant(category)]),
  ticketMessage(ticket),
];
const verified: Ticket[] = [];
const rejected: (Ticket & { label: string })[] = [];
for (const ticket of generated) {
  const label = normalize((await ask(fewShot(ticket.text))).text);
  if (label === ticket.category) verified.push(ticket);
  else rejected.push({ ...ticket, label });
}
console.log(`   kept ${verified.length}, dropped ${rejected.length}`);
for (const r of rejected.slice(0, 6)) console.log(`   ✗ written as ${r.category}, classified as ${r.label}: ${JSON.stringify(r.text.slice(0, 90))}`);
console.log();

// ─── 3 and 4. Dedupe and decontaminate ───────────────────────────────────────

// nomic-embed-text's prefix for comparing texts with each other (Module 4 used the search ones).
const vectorsOf = async (texts: string[]) => {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 16) vectors.push(...(await embed(texts.slice(i, i + 16).map((t) => `clustering: ${t}`))));
  return vectors;
};

const evalTickets = loadTickets();
const [mine, theirs] = [await vectorsOf(verified.map((t) => t.text)), await vectorsOf(evalTickets.map((t) => t.input))];

console.log("3. Deduplicating");
const unique: number[] = [];
let duplicates = 0;
for (let i = 0; i < verified.length; i++) {
  const twin = unique.find((j) => cosine(mine[i], mine[j]) > Number(values.duplicate));
  if (twin === undefined) unique.push(i);
  else if (duplicates++ < 3) console.log(`   ≈ ${JSON.stringify(verified[i].text.slice(0, 60))}\n     ${JSON.stringify(verified[twin].text.slice(0, 60))}`);
}
console.log(`   dropped ${duplicates} near-duplicates (cosine > ${values.duplicate})\n`);

console.log("4. Decontaminating: comparing with Module 3's eval tickets");
const closest = unique.map((i) => {
  const similarities = theirs.map((v) => cosine(mine[i], v));
  const best = similarities.indexOf(Math.max(...similarities));
  return { i, similarity: similarities[best], evalId: evalTickets[best].id };
});
const clean = closest.filter((c) => c.similarity <= Number(values.contaminated));
console.log(`   dropped ${closest.length - clean.length} too close to an eval ticket (cosine > ${values.contaminated})`);
console.log("   the closest ones, kept or not:");
for (const c of [...closest].sort((a, b) => b.similarity - a.similarity).slice(0, 4)) {
  console.log(`   ${c.similarity.toFixed(3)} ${c.evalId}  ${JSON.stringify(verified[c.i].text.slice(0, 70))}`);
}
console.log();

// ─── Split and save ──────────────────────────────────────────────────────────

// The chat format most trainers read: the ticket, exactly as the finetuned model will see
// it (no system prompt, no definitions), and the answer it should learn to give.
const line = (t: Ticket) => JSON.stringify({ messages: [ticketMessage(t.text), { role: "assistant", content: t.category }] });

const train: Ticket[] = [];
const valid: Ticket[] = [];
for (const category of CATEGORIES) {
  // Every sixth ticket of each category goes to validation: data the training never sees,
  // to watch the loss on during training (lesson 10.2).
  clean.map((c) => verified[c.i]).filter((t) => t.category === category).forEach((t, n) => (n % 6 === 5 ? valid : train).push(t));
}
writeFileSync(new URL("./data/tickets-train.jsonl", import.meta.url), `${train.map(line).join("\n")}\n`);
writeFileSync(new URL("./data/tickets-valid.jsonl", import.meta.url), `${valid.map(line).join("\n")}\n`);

console.log(`Saved ${train.length} training and ${valid.length} validation tickets to m10-finetune/data/`);
for (const category of CATEGORIES) {
  const count = (set: Ticket[]) => set.filter((t) => t.category === category).length;
  console.log(`   ${category.padEnd(10)} ${String(count(train)).padStart(3)} train · ${String(count(valid)).padStart(2)} valid`);
}
