// Lesson 10.4: can finetuning teach facts? Finetuning against RAG, on facts no model has
// seen: the policies of a shop that doesn't exist (data/policies.md).
//
// Five variants:
//   base         base-0.6b, the question alone: what it guesses
//   tuned        facts-0.6b, the question alone: what finetuning taught it
//   base + RAG   base-0.6b, with the three best-matching policy sections in the prompt
//   tuned + RAG  facts-0.6b, the same
//   4b + RAG     the course model, the same
// Three sets of questions. "seen" asks about each of the 16 facts with a phrasing the
// finetuning trained on, and "new" in a way it never did, often less directly. "unknown"
// asks three things the policies don't say: the right answer is "I don't know".
//
// The RAG variants use Module 4's hybrid search, so lesson 4.4 must be done.
//
// Needs facts-0.6b in Ollama:  ollama create facts-0.6b -f .cache/finetune/facts-0.6b/Modelfile
//
// Run:  npx tsx m10-finetune/facts-eval.ts        about 10 minutes on a CPU
//       add --verbose to see every answer

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { printReport, runEval, type EvalCase, type Result, type Variant } from "../common/evals";
import { ask, config, llm, system, user, type Target } from "../common/llm";
import { bm25Index } from "../m04-embeddings/bm25";
import type { Chunk } from "../m04-embeddings/corpus";
import { reciprocalRankFusion } from "../m04-embeddings/hybrid";
import { buildIndex, semanticSearch } from "../m04-embeddings/semantic";

const { values } = parseArgs({
  options: {
    tuned: { type: "string", default: "facts-0.6b" },
    base: { type: "string", default: "base-0.6b" },
    k: { type: "string", default: "3" },
    verbose: { type: "boolean", default: false },
  },
});
const base: Target = { llm, model: values.base };
const tuned: Target = { llm, model: values.tuned };
const big: Target = { llm, model: config.model };

type Fact = { id: string; input: string; seen: string; expected: string[] };
const facts: Fact[] = JSON.parse(readFileSync(new URL("./data/facts-eval.json", import.meta.url), "utf8"));
// Questions the policies don't answer, so no variant can know. An empty list means: the
// answer must say it doesn't know.
const UNKNOWN: EvalCase<string, string[]>[] = [
  { id: "gift-wrapping", input: "Do you offer gift wrapping?", expected: [] },
  { id: "assembly", input: "How much does it cost to have my furniture assembled?", expected: [] },
  { id: "student-discount", input: "Is there a student discount?", expected: [] },
];
const sets: Record<string, EvalCase<string, string[]>[]> = {
  seen: facts.map((f) => ({ id: f.id, input: f.seen, expected: f.expected })),
  new: facts.map((f) => ({ id: f.id, input: f.input, expected: f.expected })),
  unknown: UNKNOWN,
};

// ─── Retrieval: Module 4's hybrid search, over the policy document ───────────

// One chunk per section, with an id that matches the facts' ids ("Standard shipping" → standard-shipping).
const markdown = readFileSync(new URL("./data/policies.md", import.meta.url), "utf8");
const chunks: Chunk[] = markdown
  .split(/^(?=## )/m)
  .filter((part) => part.startsWith("## "))
  .map((part) => {
    const heading = part.match(/^## (.+)$/m)![1].trim();
    return { id: heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: `Lumen & Oak policies › ${heading}`, text: part.trim() };
  });
const index = await buildIndex(chunks, "embeddings-policies");
const bm25 = bm25Index(chunks);
const k = Number(values.k);
const retrieve = async (question: string) => reciprocalRankFusion([await semanticSearch(index, question, 10), bm25(question, 10)], k);
try {
  await retrieve("returns");
} catch (error) {
  console.error(`${(error as Error).message}\nThe RAG variants use Module 4's hybrid search: finish lesson 4.4 first.`);
  process.exit(1);
}

const INSTRUCTIONS = `You answer customer questions for Lumen & Oak, an online shop for furniture and lighting, using only the policy sections you are given. Answer in one or two sentences. If the sections don't answer the question, say that you don't know.`;

async function withRag(target: Target, question: string) {
  const hits = await retrieve(question);
  const sources = hits.map((h) => h.chunk.text).join("\n\n");
  return ask([system(INSTRUCTIONS), user(`<policies>\n${sources}\n</policies>\n\nQuestion: ${question}`)], { target, maxTokens: 120 });
}
const closedBook = (target: Target, question: string) => ask([user(question)], { target, maxTokens: 120 });

const variants: Variant<string>[] = [
  { name: "base", run: (q) => closedBook(base, q) },
  { name: "base + RAG", run: (q) => withRag(base, q) },
  { name: "tuned", run: (q) => closedBook(tuned, q) },
  { name: "tuned + RAG", run: (q) => withRag(tuned, q) },
  { name: "4b + RAG", run: (q) => withRag(big, q) },
];

// Right if the answer contains the fact's key value, as a whole word: "45" in "within 45 days".
// For the unknown questions, right if it says it doesn't know.
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DONT_KNOW = /\b(don['’]t|do not|doesn['’]t|does not|can['’]t|cannot) (know|say|mention|specify|include|cover|find)|\bnot (mentioned|specified|stated|covered|included)|\bno information\b/i;
const score = (output: string, expected: string[]) =>
  expected.length === 0
    ? DONT_KNOW.test(output) ? 1 : 0
    : expected.some((value) => new RegExp(`\\b${escape(value)}\\b`, "i").test(output)) ? 1 : 0;

const results: Record<string, Result[]> = {};
for (const [name, cases] of Object.entries(sets)) {
  console.log(`\n${name} questions`);
  results[name] = await runEval({ cases, variants, score });
}
for (const [name, rows] of Object.entries(results)) {
  console.log(`\n════ ${name} questions ════`);
  printReport(rows, { verbose: values.verbose, width: 140 });
}

// Retrieval on its own, as in Module 5: was the right section among the k retrieved?
console.log(`\n════ retrieval: the right section in the top ${k} ════`);
for (const [name, cases] of Object.entries(sets).filter(([name]) => name !== "unknown")) {
  const misses: string[] = [];
  for (const c of cases) if (!(await retrieve(c.input)).some((h) => h.chunk.id === c.id)) misses.push(c.id);
  console.log(`${name.padEnd(5)} ${cases.length - misses.length}/${cases.length}${misses.length ? `  missed: ${misses.join(", ")}` : ""}`);
}

console.log(`\n${"variant".padEnd(14)} ${"seen".padStart(6)} ${"new".padStart(6)} ${"unknown".padStart(8)}`);
for (const variant of variants) {
  const right = (rows: Result[]) => {
    const mine = rows.filter((r) => r.variant === variant.name);
    return `${mine.reduce((s, r) => s + r.score, 0)}/${mine.length}`;
  };
  console.log(`${variant.name.padEnd(14)} ${right(results.seen).padStart(6)} ${right(results.new).padStart(6)} ${right(results.unknown).padStart(8)}`);
}
