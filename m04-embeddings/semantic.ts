// Semantic search: embed every chunk once (that's the index), then for each query,
// embed the query and rank the chunks by cosine similarity. This is brute force, since
// the query is compared with every chunk. That's fine for thousands of chunks; Module 5
// moves to a vector database.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, embed } from "../common/llm";
import { loadCorpus, searchableText, type Chunk, type Hit } from "./corpus";
import { cosine } from "./vectors";

// nomic-embed-text was trained with these prefixes, which tell it whether a text is a
// question or a document waiting to be found. Other embedding models use other
// conventions: check the model card.
const DOCUMENT_PREFIX = "search_document: ";
export const QUERY_PREFIX = "search_query: ";

export type IndexedChunk = Chunk & { vector: number[] };

// Embed every chunk, reusing the cached vector of any chunk whose text hasn't changed.
// Indexing is the expensive part, so it happens once, not on every query. Each way of
// chunking the corpus (Module 5) keeps its own cache file, named by cacheName.
export async function buildIndex(chunks: Chunk[] = loadCorpus(), cacheName = "embeddings"): Promise<IndexedChunk[]> {
  const cacheFile = fileURLToPath(new URL(`../.cache/${cacheName}.json`, import.meta.url));
  const cached: Record<string, number[]> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const key = (chunk: Chunk) => `${config.embedModel}\n${searchableText(chunk)}`;

  // Progress goes to stderr, so it never mixes with a program's output. In an MCP server
  // (Module 7), stdout carries the protocol, and a stray line there would break it.
  const missing = chunks.filter((chunk) => !cached[key(chunk)]);
  if (missing.length > 0) {
    process.stderr.write(`Embedding ${missing.length} chunks `);
    for (let i = 0; i < missing.length; i += 8) {
      const batch = missing.slice(i, i + 8);
      const vectors = await embed(batch.map((chunk) => DOCUMENT_PREFIX + searchableText(chunk)));
      batch.forEach((chunk, j) => (cached[key(chunk)] = vectors[j]));
      process.stderr.write(".");
    }
    process.stderr.write(" done\n");
  }

  // Save only the current chunks, so vectors of deleted or edited sections don't pile up.
  const current = Object.fromEntries(chunks.map((chunk) => [key(chunk), cached[key(chunk)]]));
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(current));

  return chunks.map((chunk) => ({ ...chunk, vector: cached[key(chunk)] }));
}

export async function semanticSearch(index: IndexedChunk[], query: string, k = 5): Promise<Hit[]> {
  const [queryVector] = await embed([QUERY_PREFIX + query]);
  return index
    .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
