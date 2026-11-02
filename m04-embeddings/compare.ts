// Lesson 4.3: which kind of search works better on your notes? Measure it.
//
// Run:  npx tsx m04-embeddings/compare.ts
//
// Each query in queries.json lists the chunk(s) that answer it. A search scores 1 on
// a query if one of those chunks is in its top K results ("hit@K"). It's the same eval
// harness as in Module 3.

import { readFileSync } from "node:fs";
import { printReport, runEval, type EvalCase, type Variant } from "../common/evals";
import { bm25Index } from "./bm25";
import { loadCorpus, type Hit } from "./corpus";
import { reciprocalRankFusion } from "./hybrid";
import { buildIndex, semanticSearch } from "./semantic";

const K = 3;
const SEPARATOR = " ‖ ";

const chunks = loadCorpus();
const index = await buildIndex(chunks);
const bm25 = bm25Index(chunks);
const cases: EvalCase<string, string[]>[] = JSON.parse(readFileSync(new URL("./queries.json", import.meta.url), "utf8"));

// A query whose expected chunk no longer exists (say, after a heading was edited) can never pass.
const ids = new Set(chunks.map((chunk) => chunk.id));
for (const c of cases) for (const id of c.expected) if (!ids.has(id)) console.warn(`⚠ ${c.id} expects a chunk that doesn't exist: ${id}`);

const asOutput = (hits: Hit[]) => ({ text: hits.map((hit) => hit.chunk.id).join(SEPARATOR) });

const variants: Variant<string>[] = [
  { name: "embeddings", run: async (query) => asOutput(await semanticSearch(index, query, K)) },
  { name: "bm25", run: async (query) => asOutput(bm25(query, K)) },
];

// Hybrid takes the top 20 of each ranking and fuses them. It joins in once you've
// written reciprocalRankFusion (exercise 1).
if (isWritten()) {
  variants.push({
    name: "hybrid",
    run: async (query) => asOutput(reciprocalRankFusion([await semanticSearch(index, query, 20), bm25(query, 20)], K)),
  });
} else {
  console.log("(hybrid is skipped until you write reciprocalRankFusion in hybrid.ts)");
}

const score = (output: string, expected: string[]) => (output.split(SEPARATOR).some((id) => expected.includes(id)) ? 1 : 0);

console.log(`\n${chunks.length} chunks · ${cases.length} queries · hit@${K}\n`);
printReport(await runEval({ cases, variants, score }), { width: 400 });

function isWritten(): boolean {
  try {
    reciprocalRankFusion([[]]);
    return true;
  } catch {
    return false;
  }
}
