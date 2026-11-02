// Lesson 5.1: how big should a chunk be? Measure retrieval at several sizes.
//
// Run:  npx tsx m05-rag/chunk-eval.ts
// The first run embeds the corpus once per chunk size (several minutes on a CPU); later runs use the cache.

import { readFileSync } from "node:fs";
import { printReport, runEval, type EvalCase, type Variant } from "../common/evals";
import { loadQuestions } from "./questions";
import { createRetriever, sectionOf, type Retriever } from "./retrieve";

// The overlap comes from createRetriever, so rag.ts --chunk-size N cuts exactly the same chunks.
const STRATEGIES = [
  { name: "sections", chunkSize: 0 },
  { name: "1500 chars", chunkSize: 1500 },
  { name: "800 chars", chunkSize: 800 },
  { name: "400 chars", chunkSize: 400 },
];
const K = 3;
const SEPARATOR = " ‖ ";

// Questions whose answer location we know: Module 4's, plus Module 5's answerable ones.
const moduleFour: EvalCase<string, string[]>[] = JSON.parse(
  readFileSync(new URL("../m04-embeddings/queries.json", import.meta.url), "utf8"),
);
const moduleFive = loadQuestions()
  .filter((q) => q.expected.answer !== null)
  .map((q) => ({ id: q.id, input: q.input, expected: q.expected.sections }));
const cases = [...moduleFour, ...moduleFive];

const retrievers: Retriever[] = [];
for (const strategy of STRATEGIES) retrievers.push(await createRetriever(strategy));

// Every chunk you retrieve goes into the prompt, and on a CPU each token in the
// prompt costs time (about 47 tokens per second, Module 1).
console.log(`\nstrategy       chunks   avg chars   ≈ prompt tokens for ${K} chunks`);
STRATEGIES.forEach((strategy, i) => {
  const { chunkCount, averageLength } = retrievers[i];
  console.log(
    `${strategy.name.padEnd(12)} ${String(chunkCount).padStart(8)} ${String(averageLength).padStart(11)} ${String(Math.round((averageLength * K) / 4)).padStart(20)}`,
  );
});

// A question passes if one of its top K chunks comes from a section that answers it.
const variants: Variant<string>[] = STRATEGIES.map((strategy, i) => ({
  name: strategy.name,
  run: async (query) => ({ text: (await retrievers[i].search(query, K)).hits.map((hit) => sectionOf(hit.chunk.id)).join(SEPARATOR) }),
}));
const score = (output: string, expected: string[]) => (output.split(SEPARATOR).some((section) => expected.includes(section)) ? 1 : 0);

console.log(`\n${cases.length} questions · hit@${K}\n`);
printReport(await runEval({ cases, variants, score }), { width: 300 });
