// Checks for hybrid search.  Run:  npx tsx --test m04-embeddings/hybrid.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hit } from "./corpus";
import { reciprocalRankFusion } from "./hybrid";

// A ranking of fake chunks, best first, with made-up scores.
const ranking = (ids: string[], scale = 1): Hit[] =>
  ids.map((id, i) => ({ chunk: { id, title: id, text: id }, score: (10 - i) * scale }));

const SEMANTIC = ranking(["a", "b", "c"]);
const KEYWORD = ranking(["b", "d", "a"]);

test("a chunk ranked high in both lists comes first", () => {
  // b: 1/62 + 1/61 = 0.0325    a: 1/61 + 1/63 = 0.0323    d: 1/62 = 0.0161    c: 1/63 = 0.0159
  const fused = reciprocalRankFusion([SEMANTIC, KEYWORD]);
  assert.deepEqual(
    fused.map((hit) => hit.chunk.id),
    ["b", "a", "d", "c"],
  );
});

test("the score is the sum of 1 / (60 + rank)", () => {
  const b = reciprocalRankFusion([SEMANTIC, KEYWORD]).find((hit) => hit.chunk.id === "b");
  assert.ok(b && Math.abs(b.score - (1 / 62 + 1 / 61)) < 1e-9, `got ${b?.score}`);
});

test("only ranks matter, not the original scores", () => {
  const fused = reciprocalRankFusion([ranking(["a", "b", "c"], 1000), KEYWORD]);
  assert.deepEqual(
    fused.map((hit) => hit.chunk.id),
    ["b", "a", "d", "c"],
  );
});

test("returns at most k results", () => {
  assert.equal(reciprocalRankFusion([SEMANTIC, KEYWORD], 2).length, 2);
});

test("works with empty rankings", () => {
  assert.deepEqual(reciprocalRankFusion([[], []]), []);
});
