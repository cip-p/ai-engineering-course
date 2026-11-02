# Module 4 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the numbers from [Reference results](README.md#reference-results-67-chunks-nomic-embed-text). This file isn't part of the search corpus (only `README.md` is), so it doesn't change the Module 4 and 5 evals.

## 1. What is an embedding, and what does cosine similarity measure?

An **embedding** is a list of numbers that represents a text's meaning: 768 numbers for `nomic-embed-text`. An embedding model doesn't generate text. It was trained so that texts with similar meanings get vectors pointing in similar directions.

**Cosine similarity** measures the angle between two vectors:
- **1:** they point the same way;
- **around 0:** unrelated;
- **-1:** opposite.

It measures closeness of **topic, not truth**. Your negation pair ("I love coffee" vs. "I don't love coffee") scored 0.85, the most similar pair of all. On your notes, unrelated chunks still score around 0.45, so in practice "nothing matches" sits well above 0.

## 2. Why do we embed sections instead of whole files?

Each text gets **one** vector. A whole README covers ten topics, so its vector is a blur of all of them and matches no single question well. A whole file is also too big to put in a prompt.

A section gives a focused vector and returns just the relevant part. Module 5 takes this further:
- **Long, multi-topic sections still blur.** Whole sections missed q04 and r03.
- **Pieces that are too small lose context,** and the model fills the gaps.

## 3. Give one kind of query where BM25 beats embeddings, and one where embeddings win. Why?

- **BM25 wins on exact, rare terms:** identifiers, error messages, names, like `max_completion_tokens` or "Mocha Haven". It rewards rare words that match exactly. Embeddings missed q04 and q08, including a rare exact word buried in a section about something else, which drowned in that section's overall meaning.
- **Embeddings win on paraphrases.** q03 asked "how long did my laptop take to read a long prompt?", while your notes say "prefill" and "TTFT". BM25 only counts shared words, so it sees nothing. Embeddings compare meaning. BM25 missed q03 and q05, and it was drawn to short sections made of questions.

The two methods failed on different questions, which is why hybrid search combines them.

## 4. Why can't you just add a BM25 score to a cosine score? How does RRF get around that?

They're on different scales:
- **Cosine** is between -1 and 1. On your notes it mostly sits between ~0.45 and ~0.8.
- **BM25** has no upper limit, and it depends on the query's length and on how rare its words are.

Add them and whichever has bigger numbers dominates. Normalizing the scores is fragile.

**RRF ignores the scores and uses ranks.** Each chunk earns `1 / (60 + rank)` from each ranking, and the points are added up. Rank 1 in one list earns 1/61 ≈ 0.016. Rank 5 in *both* lists earns 2/65 ≈ 0.031. So agreement beats one strong opinion. That's why hybrid search scored 92% but lost q04: only BM25 had found it.

## 5. Why is indexing the expensive part, and what has to happen when a document changes?

Indexing runs the embedding model once per chunk. That took a minute or two for ~70 sections on the reference laptop (CPU only), and several minutes per chunk size in Module 5. A query needs only one embedding (~0.1 s) plus some arithmetic. So you index once and query many times.

When a document changes:
- **Re-chunk it.**
- **Re-embed the chunks whose text changed,** and drop the vectors of chunks that no longer exist. Your cache is keyed on the text, which is what the "Embedding 4 chunks" lines were.
- **BM25 statistics change too,** because word rarity is counted over the whole corpus.

If you switch to a different embedding model, re-embed **everything**. Vectors from different models can't be compared, which is why the model name is part of the cache key.

Module 5 adds a lesson here: when the documents change, rerun the eval too. Questions that used to pass can start failing without any code change.

## Solution: lesson 4.4's `reciprocalRankFusion`

Try it yourself first: the tests tell you when you're done. One way to write it, in `hybrid.ts`:

```ts
export function reciprocalRankFusion(rankings: Hit[][], k = 5): Hit[] {
  const totals = new Map<string, Hit>(); // chunk id → the chunk and its points so far

  for (const ranking of rankings) {
    ranking.forEach((hit, index) => {
      const points = 1 / (RRF_K + index + 1); // index 0 is rank 1
      const total = totals.get(hit.chunk.id);
      if (total) total.score += points;
      else totals.set(hit.chunk.id, { chunk: hit.chunk, score: points });
    });
  }

  return [...totals.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
```

The map is keyed on the chunk's id, so a chunk found by both methods collects points from both lists. Each entry is a new object, so the rankings you were given keep their original scores.
