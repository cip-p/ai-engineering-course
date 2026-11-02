// BM25: the classic keyword search. Search engines used it long before embeddings, and
// they still use it alongside them. A chunk scores high when it contains the query's
// words, especially rare words, and especially if the chunk is short. No model is
// involved: it's all counting.

import { searchableText, type Chunk, type Hit } from "./corpus";

const K1 = 1.2; // how quickly repeating a word stops adding to the score
const B = 0.75; // how much long chunks are penalized (0 = not at all, 1 = fully)

// Lowercase words and numbers. "max_completion_tokens" stays one word, and "Tokens"
// and "tokens" match, but "token" and "tokens" don't (no stemming).
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

// Count everything once, up front, and return a search function that uses the counts.
export function bm25Index(chunks: Chunk[]): (query: string, k?: number) => Hit[] {
  const documents = chunks.map((chunk) => {
    const terms = words(searchableText(chunk));
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    return { chunk, counts, length: terms.length };
  });
  const averageLength = documents.reduce((sum, d) => sum + d.length, 0) / documents.length;

  // In how many chunks each word appears. The rarer the word, the more a match means.
  const documentFrequency = new Map<string, number>();
  for (const d of documents) for (const term of d.counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);

  return (query, k = 5) => {
    const terms = [...new Set(words(query))];
    return documents
      .map((d) => {
        let score = 0;
        for (const term of terms) {
          const count = d.counts.get(term) ?? 0;
          if (count === 0) continue;
          const df = documentFrequency.get(term)!;
          const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5)); // rare word → big weight
          const lengthPenalty = 1 - B + (B * d.length) / averageLength;
          score += (idf * count * (K1 + 1)) / (count + K1 * lengthPenalty); // repeats help less and less
        }
        return { chunk: d.chunk, score };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };
}
