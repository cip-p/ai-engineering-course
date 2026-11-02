// Lesson 4.1: what an embedding is, and what "similar" means to an embedding model.
//
// Run:  npx tsx m04-embeddings/embed-lab.ts

import { config, embed } from "../common/llm";
import { cosine, norm } from "./vectors";

const SENTENCES = [
  "The cat sat on the mat.",
  "A kitten was resting on the rug.", // same meaning as S1, almost no shared words
  "The stock market fell sharply today.",
  "Shares dropped steeply this afternoon.", // same meaning as S3
  "I love coffee.",
  "I don't love coffee.", // nearly the same words as S5, opposite meaning
  "I sat on the river bank.",
  "I deposited money at the bank.", // same word "bank", different meaning from S7
];

const vectors = await embed(SENTENCES);
const label = (i: number) => `S${i + 1}`;

console.log(`Model: ${config.embedModel}\n`);
console.log(`Each sentence became a list of ${vectors[0].length} numbers. The first 8 for "${SENTENCES[0]}":`);
console.log(`  [${vectors[0].slice(0, 8).map((x) => x.toFixed(3)).join(", ")}, …]`);
console.log(`  length of the vector: ${norm(vectors[0]).toFixed(3)}\n`);

console.log("Cosine similarity of every pair (1 = same direction):\n");
console.log(`     ${SENTENCES.map((_, j) => label(j).padStart(6)).join("")}`);
vectors.forEach((a, i) => {
  console.log(`${label(i).padEnd(5)}${vectors.map((b) => cosine(a, b).toFixed(2).padStart(6)).join("")}   ${SENTENCES[i]}`);
});

console.log("\nThe closest other sentence to each one:");
vectors.forEach((a, i) => {
  let best = -1;
  for (let j = 0; j < vectors.length; j++) {
    if (j !== i && (best === -1 || cosine(a, vectors[j]) > cosine(a, vectors[best]))) best = j;
  }
  console.log(`  ${label(i)} → ${label(best)}  ${cosine(a, vectors[best]).toFixed(2)}   "${SENTENCES[i]}" ↔ "${SENTENCES[best]}"`);
});
