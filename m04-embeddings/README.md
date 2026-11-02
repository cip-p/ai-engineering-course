# Module 4: Embeddings and semantic search

*Book: chapter 6 (retrieval, the "R" in RAG)*

**Goal:** given a question, find the piece of text that answers it, first by meaning (embeddings) and then by words (BM25), and measure which works better. This is the retrieval half of RAG. Module 5 adds the generation half.

## Concepts (read before running anything)

1. **An embedding is a list of numbers that represents meaning.** An embedding model doesn't generate text. It turns text into a vector (768 numbers for `nomic-embed-text`, the third model you pulled in Module 0). It was trained so that texts with similar meanings get vectors pointing in similar directions.

2. **Cosine similarity** measures the angle between two vectors:
   - **1:** they point the same way;
   - **around 0:** unrelated;
   - **-1:** opposite.

   To search, embed the question, compare it with every chunk's vector, and keep the closest. That's *brute force*, and it's fine for thousands of chunks.

3. **Index once, query many times.** Embedding all the documents is the expensive part. You do it once and store the vectors (here in `.cache/embeddings.json`). After that, each query costs one embedding plus some arithmetic. When a document changes, its vector has to be recomputed.

4. **Keyword search (BM25) vs. meaning search (embeddings).**

   | | BM25 | Embeddings |
   |---|---|---|
   | **How it works** | Counts word matches. Rare words count more, repeated words count less and less, and long chunks are penalized | Compares vector directions |
   | **Needs a model?** | No | Yes |
   | **Good at** | Exact names, codes, error messages, rare terms | Paraphrases and synonyms ("kitten" ≈ "cat") |
   | **Weak at** | Paraphrases and synonyms, because if the words differ it sees nothing | Exact identifiers, numbers, negation ("love" vs. "don't love") |

   Each one is weak where the other is strong, which is why real systems often use both: **hybrid search**.

5. **Search chunks, not whole files.** A whole README covers ten topics, so its single vector is a blur of all of them. Here every section (at each `##` or `###` heading) is a chunk. Module 5 goes deeper into chunking.

6. **Query vs. document prefixes.** `nomic-embed-text` was trained to expect `search_query: ` in front of questions and `search_document: ` in front of the texts being searched. Embedding models have different conventions like this one, so read the model card.

7. **Measuring retrieval: hit@k.** Is a chunk that answers the question among the top k results? It uses the same eval harness as Module 3.

## The corpus: your course notes

The corpus is `COURSE.md`, every module's `README.md`, and any Markdown files you put in `data/notes/`, split into one chunk per section. Each chunk's id says where it came from, for example `m01-basics/README.md › Setup (once)`.

You'll ask questions about things you've done. The corpus already holds every module's README, including the ones you haven't reached yet, and it grows with your own notes. It's what the Slack study assistant will search in Module 8.

## Setup

No new packages. Check that the embedding model is there:

```bash
ollama list          # should include nomic-embed-text; if not: ollama pull nomic-embed-text
```

## Lesson 4.1: What an embedding is (`embed-lab.ts`)

```bash
npx tsx m04-embeddings/embed-lab.ts
```

**What to notice**
- **How many numbers each vector has.** If its length prints as `1.000`, the server already normalizes vectors, so cosine similarity equals the plain dot product.
- **S1/S2 and S3/S4** say the same thing in different words. Are they each other's closest match?
- **S5/S6** ("I love coffee" vs. "I don't love coffee"): opposite meanings. How similar do they look to the model?
- **S7/S8** both say "bank", with different meanings. Similar or not?

## Lesson 4.2: Search your notes (`search.ts`)

```bash
npx tsx m04-embeddings/search.ts "how do I give the bot a personality?"
npx tsx m04-embeddings/search.ts "Mocha Haven"
```

The first run embeds the whole corpus, which takes a minute or two on a CPU (seconds on a GPU). Later runs reuse the cache, and only new or edited sections get embedded again.

**What to notice**
- **For the first question,** the words don't match the notes exactly. Which method finds the persona exercise?
- **For "Mocha Haven"**, an exact name, which method is more confident?
- **The score columns aren't comparable.** Cosine is at most 1, while BM25 has no upper limit. Remember this for lesson 4.4.
- Try your own questions about Modules 1–3.

## Lesson 4.3: Measure it (`compare.ts`)

`queries.json` has 12 questions, each listing the chunk(s) that answer it. Some are worded differently from the notes, and one is an exact technical term.

```bash
npx tsx m04-embeddings/compare.ts
```

**What to notice**
- **The hit@3 score of each method.**
- **The failures:** for each miss, what did it find instead? Is it a near-miss (a neighbouring section) or something unrelated?
- **Where the two methods disagree:** which queries does each one get that the other misses, and why?

## Lesson 4.4: Hybrid search (`hybrid.ts`, you write the code)

Implement `reciprocalRankFusion` in `hybrid.ts`. It combines the two rankings using **ranks instead of scores**, since the scores aren't comparable. The comment in the file explains the formula.

```bash
npx tsx --test m04-embeddings/hybrid.test.ts
npx tsx m04-embeddings/compare.ts           # hybrid now appears as a third row
```

## Exercises

1. **Hybrid.** Write `reciprocalRankFusion`, pass the tests, and rerun `compare.ts`. Does hybrid beat both methods? On which queries does it help?
2. **Your own notes.** Create `data/notes/module-1.md` with your checkpoint answers from Module 1, under `##` headings. Search for something only your notes contain. Note that only the new sections get embedded.
3. **Break each method.** Find a query that BM25 answers and embeddings miss, and one where it's the other way round. Add both to `queries.json`, with your reasoning in the query's `id`.
4. **Do the prefixes matter?** Set `DOCUMENT_PREFIX` and `QUERY_PREFIX` in `semantic.ts` to `""`, delete `.cache/embeddings.json`, and rerun `compare.ts`. Then put them back.
5. **Naive stemming.** BM25 doesn't match "token" with "tokens". Make `words()` in `bm25.ts` drop a trailing "s" from every word and rerun `compare.ts`. Better, worse, or no change? Why might it hurt?
6. **The k in hit@k.** Change `K` in `compare.ts` to 1, then to 5. How do the methods compare at each value? Which one would you use when you can only show the user one result?

## Checkpoint (answer in your own words)

1. What is an embedding, and what does cosine similarity measure?
2. Why do we embed sections instead of whole files?
3. Give one kind of query where BM25 beats embeddings, and one where embeddings win. Why?
4. Why can't you just add a BM25 score to a cosine score? How does RRF get around that?
5. Why is indexing the expensive part, and what has to happen when a document changes?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (67 chunks, `nomic-embed-text`)

These were measured while the course had four modules, so the corpus held 67 chunks. A fresh clone has every module's README from the start, electives included: 177 chunks. On the same laptop that gave embeddings 75%, BM25 83% and hybrid 75%: BM25 won, hybrid lost two of its questions (q08 and q10) and did no better than embeddings alone, and among the misses, sections of the electives took places in the top 3. (With the 140 chunks the course had before the finetuning, inference and hosted-models electives, it was 75%, 92% and 83%.) That's this module's lesson about the corpus, on a bigger scale: compare the shape of your results with the findings below, not the digits.

| Measurement | Value |
|---|---|
| Paraphrase pairs (embed lab) | 0.69 and 0.82 |
| Negation pair (embed lab) | **0.85**, the most similar pair of all |
| Unrelated chunks in search | around 0.45: the "nothing matches" level |
| hit@3, embeddings | 83% (missed q04, q08) |
| hit@3, BM25 | 83% (missed q03, q05) |
| hit@3, hybrid (RRF) | **92%** (missed q04) |
| Time per query | about 0.1 s (embeddings), about 0 s (BM25) |

**What these runs showed**
- **Embeddings capture topic, not truth.** A sentence and its negation look almost identical to the model. Retrieval finds candidates; the generator has to read them carefully.
- **The two methods fail differently.** Same score, but no question was missed by both. Embeddings missed a rare exact word buried in a section about something else, and a long multi-topic section. BM25 missed a question worded differently from the notes, and was drawn to short sections made of questions.
- **Read the shape of the scores.** A weak top score with no gap after it means nothing really matched.
- **RRF rewards agreement.** It fixed three of the four misses, but lost the one question that only BM25 got right. Fixing it by tuning would mean overfitting to a 12-question eval; add questions first.
- **Long, multi-topic sections hurt retrieval.** That's the starting point of Module 5.

## Troubleshooting

| Problem | Fix |
|---|---|
| `model "nomic-embed-text" not found` | `ollama pull nomic-embed-text` |
| `⚠ q.. expects a chunk that doesn't exist` | A README heading changed. Update the id in `queries.json` |
| Results look stale after editing notes | Shouldn't happen (the cache is keyed on the text), but deleting `.cache/embeddings.json` forces a full re-embed |
| `TODO: implement reciprocalRankFusion` | Expected until you write it. `compare.ts` skips hybrid until then |
