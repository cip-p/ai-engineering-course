// Retrieval for RAG: Module 4's hybrid search, over chunks of whatever size you choose.

import { bm25Index } from "../m04-embeddings/bm25";
import { loadCorpus, type Hit } from "../m04-embeddings/corpus";
import { reciprocalRankFusion } from "../m04-embeddings/hybrid";
import { buildIndex, semanticSearch } from "../m04-embeddings/semantic";
import { splitBySize } from "./chunking";

export type Retrieved = {
  hits: Hit[];
  bestSimilarity: number; // the top cosine similarity: a hint of how well anything matched (Module 4)
};

export type Retriever = {
  chunkCount: number;
  averageLength: number; // in characters
  search: (query: string, k: number) => Promise<Retrieved>;
};

// chunkSize 0 means whole sections, as in Module 4. The overlap defaults to an eighth
// of the chunk, at most 150 characters (a sentence or two): 1500 → 150, 800 → 100, 400 → 50.
export async function createRetriever({
  chunkSize = 800,
  overlap = Math.min(150, Math.round(chunkSize / 8)),
} = {}): Promise<Retriever> {
  const sections = loadCorpus();
  const chunks = chunkSize > 0 ? splitBySize(sections, chunkSize, overlap) : sections;
  const index = await buildIndex(chunks, chunkSize > 0 ? `embeddings-${chunkSize}-${overlap}` : "embeddings");
  const bm25 = bm25Index(chunks);

  return {
    chunkCount: chunks.length,
    averageLength: Math.round(chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / chunks.length),
    search: async (query, k) => {
      const semantic = await semanticSearch(index, query, 20);
      return {
        hits: reciprocalRankFusion([semantic, bm25(query, 20)], k),
        bestSimilarity: semantic[0]?.score ?? 0,
      };
    },
  };
}

// The section a chunk came from. Pieces of a section are named "<section id> [part 2]".
export const sectionOf = (chunkId: string) => chunkId.replace(/ \[part \d+\]$/, "");
