// Lesson 4.4: hybrid search. Combine the embedding ranking and the BM25 ranking.
//
// Their scores can't be added: cosine similarity runs from -1 to 1, while BM25 has no
// upper limit. So combine their RANKS instead, with Reciprocal Rank Fusion (RRF).
//
// Check your work:  npx tsx --test m04-embeddings/hybrid.test.ts

import type { Hit } from "./corpus";

const RRF_K = 60; // the usual constant; it stops the top rank from dominating everything

// TODO: Reciprocal Rank Fusion. In each ranking, the chunk at rank r (starting at 1) earns
// 1 / (RRF_K + r) points, and a chunk's total is the sum over every ranking it appears
// in. The original scores are ignored: only positions count. Being fairly high in both
// lists beats being first in just one. Return the k chunks with the most points, best
// first, each with its total as its score. Module 5 on uses this function for every
// search, so finish it before you move on.
export function reciprocalRankFusion(rankings: Hit[][], k = 5): Hit[] {
  throw new Error("TODO: implement reciprocalRankFusion in m04-embeddings/hybrid.ts (lesson 4.4)");
}
