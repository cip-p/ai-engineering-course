// Lesson 4.2: search your course notes two ways, side by side.
//
// Run:  npx tsx m04-embeddings/search.ts "how do I give the bot a personality?"
//       npx tsx m04-embeddings/search.ts "Mocha Haven"

import { bm25Index } from "./bm25";
import { loadCorpus, type Hit } from "./corpus";
import { buildIndex, semanticSearch } from "./semantic";

const query = process.argv[2];
if (!query) {
  console.error('Usage: npx tsx m04-embeddings/search.ts "your question"');
  process.exit(1);
}

const chunks = loadCorpus();
const index = await buildIndex(chunks); // embeds the corpus on the first run, then reuses the cache
const bm25 = bm25Index(chunks);

console.log(`\nSearching ${chunks.length} chunks of your notes for: "${query}"`);
print("embeddings: closest in meaning (cosine similarity)", await semanticSearch(index, query));
print("BM25: best keyword match (no upper limit on the score)", bm25(query));

function print(title: string, hits: Hit[]) {
  console.log(`\n── ${title} ──`);
  if (hits.length === 0) console.log("  (no chunk contains any of the query's words)");
  hits.forEach((hit, i) => {
    console.log(`  ${i + 1}. ${hit.score.toFixed(3).padStart(7)}  ${hit.chunk.id}`);
    console.log(`              ${snippet(hit.chunk.text)}`);
  });
}

// The start of the section, without its heading line.
function snippet(text: string, max = 110): string {
  const body = text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
}
