# Module 5: RAG (retrieval-augmented generation)

*Book: chapter 6*

**Goal:** answer questions about your course notes with the model, grounded in the notes and citing them, and measure it well enough to tell *why* an answer was wrong.

Module 4 built the retrieval half. This module adds the generation half and puts the two together.

## Concepts (read before running anything)

1. **The pipeline.**

   ```
   once, ahead of time:  load notes → chunk → embed → index
   for each question:    embed the question → retrieve the top k chunks → build the prompt → generate the answer (with citations)
   ```

   The model never searches anything itself. Your code picks what it gets to read, which is exactly the "the app decides what's sent" idea from Module 1.

2. **Chunking.** Chunk size is a trade-off:
   - **Small chunks** match precisely, but lose context: a piece can say "this halves the time" without saying what "this" is.
   - **Big chunks** keep the context, but each vector blurs several topics (Module 4's failures), and they fill the prompt.

   Two ways to soften the trade-off:
   - **Overlap:** each piece repeats the end of the previous one, so a sentence cut at the boundary still appears whole somewhere.
   - **Contextual headers:** every piece keeps its section's title, so a piece from the middle still says where it came from.

   There are two families of chunking:
   - **Structure-aware:** cut at headings, as in Module 4.
   - **Fixed-size:** cut every N characters, as here. It ignores the structure (tables and lists get flattened), but it bounds the size.

3. **The prompt.** Instructions first, then the numbered sources, then the question. That's Module 1's caching rule again: the instructions stay cached, while the sources change with every question. The instructions say to answer **only from the sources**, to **cite** them, and to reply with a fixed "I don't know" sentence when the answer isn't there.

4. **k and cost.** Every retrieved chunk goes into the prompt, and the prompt is prefill. On a CPU that's tens of tokens per second (about 47 on the reference laptop). Three chunks of 800 characters come to about 600 tokens, so expect around 13 seconds before the first word there. More chunks give the model a better chance of seeing the answer, but make you wait longer and give it more noise to read past.

5. **Two halves, two kinds of failure.** When an answer is wrong, the first question is: **did retrieval bring back the right source?**

   | Right source retrieved? | Answer | Failure | Fix |
   |---|---|---|---|
   | No | Wrong | **Retrieval** | Chunking, the query, hybrid search, a larger k |
   | Yes | Wrong | **Generation** | The prompt, a bigger model, fewer distracting chunks |
   | — (unanswerable) | Answered anyway | **Hallucination** | Better "I don't know" behaviour |

   So you measure retrieval (hit@k) **separately** from the answer (correctness, judged against a reference answer).

6. **Vector databases.** Module 4 kept its vectors in plain arrays. A vector database adds:
   - **persistence:** the vectors survive restarts;
   - **updates:** you can add and delete rows;
   - **metadata and SQL alongside the vectors.**

   At millions of vectors, comparing a query with every vector gets too slow. Databases then use **approximate nearest-neighbour** indexes, such as HNSW (book ch. 6), which trade a little accuracy for a lot of speed. At your scale (a few hundred chunks), exact brute force takes milliseconds.

   The course uses **sqlite-vec** rather than LanceDB, which no longer ships an Intel Mac binary (the same story as ONNX Runtime in Module 2). sqlite-vec runs inside SQLite, which is built into Node, and ships binaries for macOS and Linux.

## Setup

Nothing new for lessons 5.1–5.3. Everything builds on Module 4's search (`m04-embeddings/`), including your `reciprocalRankFusion` from lesson 4.4: every search in this module is hybrid, so make its tests pass first. Lesson 5.4 needs one package:

```bash
npm install sqlite-vec          # only for lesson 5.4
```

## Lesson 5.1: Chunk size (`chunk-eval.ts`)

This measures retrieval (hit@3) for four chunking strategies: whole sections (Module 4), and fixed-size chunks of 1500, 800 and 400 characters. It uses 22 questions with known answer locations: Module 4's 12, plus the answerable ones from `questions.json`.

```bash
npx tsx m05-rag/chunk-eval.ts
```

The first run embeds your notes once per chunk size, which takes several minutes. Everything is cached afterwards.

**What to notice**
- **The size table:** the number of chunks, and **how many prompt tokens 3 chunks cost**. Without a GPU, that's waiting time.
- **hit@3 per strategy.** Is smaller always better? Which questions does each size miss?
- Remember that 22 questions is still a small eval, so treat a difference of one question as noise.

## Lesson 5.2: RAG (`rag.ts`)

```bash
npx tsx m05-rag/rag.ts "What does the --no-memory flag prove?"
npx tsx m05-rag/rag.ts "Who wrote the book this course follows?"
npx tsx m05-rag/rag.ts "What's the best pizza in Naples?"
npx tsx m05-rag/rag.ts --show-prompt "What does the --no-memory flag prove?"
```

**What to notice**
- **The citations [1], [2]:** check them against the source list. Do they point to sources that really say that?
- **The pizza question:** the notes can't answer it. Does the model say "I don't know", or does it answer from its own general knowledge?
- **`--show-prompt`:** this is everything the model sees. The model isn't searching anything; your code picked these chunks.
- **The timing line.** Compare the "first word after" time with `--k 1` and `--k 5`.

## Lesson 5.3: Evaluate it (`rag-eval.ts`)

There are 12 questions in `questions.json`. Ten have reference answers in your notes, and **two can't be answered from your notes**. The last two, r11 and r12, are failures you found by hand in lesson 5.2: every failure you find by hand should become an eval case. For each question, the script retrieves, answers, has a local judge compare the answer with the reference, and **diagnoses** what went wrong.

```bash
npx tsx m05-rag/rag-eval.ts
```

This takes about 5–10 minutes on a CPU.

**What to notice**
- **The diagnosis column:** retrieval failures, generation failures and hallucinations each have a different fix (concept 5).
- **The "best sim" column:** compare the two unanswerable questions with the answerable ones. Is there a clear gap? You'll use it in exercise 3.
- **The answers themselves:** do you agree with the judge? It's a 4B model judging a 4B model (Module 3's warning).

## Lesson 5.4 (optional): A vector database (`vector-db.ts`)

```bash
npm install sqlite-vec
npx tsx m05-rag/vector-db.ts "What does the --no-memory flag prove?"
```

This stores the 800-character chunks and their vectors in `.cache/notes.db`, runs the nearest-neighbour search **in SQL**, and prints it next to Module 4's hand-written search. The two rankings should match, with tiny differences because the database stores 32-bit numbers. That's the point of the lesson: **a vector database does the same arithmetic you wrote in Module 4, plus storage.** Node may print an `ExperimentalWarning` about SQLite, which is harmless.

## Exercises

1. **Choose your chunk size.** Rerun `rag-eval.ts` with `--chunk-size` set to the best strategy from 5.1, and with `--chunk-size 0` (whole sections). Compare the scores *and* the time per question. Which would you ship on your machine?
2. **k.** Run `rag-eval.ts` with `--k 1`, `--k 3` and `--k 5`. Plot (or just list) correct answers against average time. Where's the sweet spot?
3. **An "I don't know" gate.** In `rag.ts`, if `bestSimilarity` is below a threshold, skip the model entirely and print `DONT_KNOW`. Pick the threshold from the best-sim column in 5.3. What does it cost on the answerable questions?
4. **Check the citations.** After generating, check that every `[n]` in the answer refers to a source that was actually provided, and flag answers that cite nothing.
5. **Source order.** Put the best chunk last instead of first (reverse `hits` in `ragMessages`). Do the answers change? Models tend to pay most attention to the beginning and end of a prompt (book ch. 5).
6. **Your own notes.** Add Markdown to `data/notes/`, ask about it with `rag.ts`, and add a question about it to `questions.json`.
7. **A hosted model.** Run `rag-eval.ts --profile hf` (see Module 3 for the profile setup). How much is the slowness, and how much is the quality, down to your local model?
8. **Clean the corpus.** This README quotes lesson 5.2's questions word for word, and every Checkpoint asks questions without answering them. Both pull retrieval away from the real answers. In `loadCorpus` (`m04-embeddings/corpus.ts`), drop one of them: Checkpoint sections, or the lines inside ``` code blocks. Before you run anything, predict what each rule will fix and what it might break. Then rerun `chunk-eval.ts` and `rag-eval.ts`, and watch r11. The changed chunks get re-embedded, which takes a few minutes.

## Checkpoint (answer in your own words)

1. Name the steps of the RAG pipeline. Which ones happen once, and which happen for every question?
2. Your RAG gives a wrong answer. How do you tell whether retrieval or generation failed?
3. Smaller vs. bigger chunks: what do you gain and lose either way? Use your numbers from 5.1.
4. Why does k affect both answer quality and speed on your machine?
5. How does the model "know" to say "I don't know"? Why is that unreliable, and what else could you do?
6. What does a vector database add over Module 4's arrays? When would you need approximate search?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (k = 3, `qwen3:4b-instruct-2507-q4_K_M`)

This README is part of the corpus, so the questions appear here by id only.

**One question has changed since these runs.** COURSE.md's opening paragraph was rewritten afterwards, and it now holds r12's answer in r12's own words. On a fresh clone the first search finds it and r12 passes: on the reference laptop the eval then scored 9/12 rather than 8/12. Modules 6 and 8 reuse the same question as t06 and s02, so their notes about it describe the course as it was.

| Measurement | Value |
|---|---|
| hit@3 by chunk size (5.1, 20 questions) | sections 80%, 1500 chars 85%, 800 chars 75%, **400 chars 90%** |
| Prompt tokens for 3 chunks | sections ~600, 800 chars ~410, 400 chars ~245 |
| End-to-end (5.3, 12 questions) | **8/12 at every size**: 800, 400 and whole sections |
| Wrong answers instead of "I don't know" | **800: 0**, sections: 1, 400: 2 |
| Time per question, judge included | 800: 18 s, sections: 27 s, 400: 35 s (one run, probably disturbed) |
| Prefill speed for RAG prompts (600–800 tokens) | ~80 tokens/s |
| sqlite-vec vs. the hand-written search | the same top 5, with the same scores to 3 decimals |
| Setup you'd ship | **800-character chunks, k = 3** |

**What these runs showed**
- **Same score, different systems.** All three chunk sizes got 8/12. At 800, every failure was a safe "I don't know". At 400, two failures were confident wrong answers with citations. Count the wrong answers, not just the right ones.
- **Retrieval was the bottleneck, not the 4B model.** At 800, every question whose source was in the prompt got a right answer, and every failure was a retrieval miss.
- **hit@3 flatters small chunks.** It counts any piece of the right section. At 400, r08 got the right section but the wrong piece, and the model built an answer out of it. 5.1 favoured 400, and the end-to-end eval reversed that.
- **Similarity measures resemblance, not answers.** Text that repeats a question (this README's example commands, the Checkpoint lists) ranked above the real answer. An unanswerable question (r09) scored 0.71, as high as the answerable ones, so a similarity threshold can't separate them.
- **On-topic sources that don't answer are the dangerous ones.** With nothing relevant in the prompt, the model said "I don't know". With related text that didn't contain the answer, it sometimes improvised and cited a source that didn't support it. The judge can't catch every such claim, because it checks key facts, not faithfulness.
- **The corpus moves the eval.** Editing the notes changed results with no code change. A question that used to pass started failing, and r11 flipped between runs. Rerun the eval when the documents change, and keep eval questions out of the documents you search.
- **Failures found by hand become eval cases** (r11, r12). Neither is fixed yet; exercise 8 goes after r11.
- **A vector database is the same arithmetic plus storage.** At ~120 chunks, search takes milliseconds, while reading the prompt and writing the answer take ~15 s.

## Troubleshooting

| Problem | Fix |
|---|---|
| The first run of 5.1 or 5.2 takes minutes | It's embedding your notes at that chunk size. It's cached for later runs |
| `TODO: implement reciprocalRankFusion` | Lesson 4.4 isn't done yet. Write it and run its tests (Module 4) |
| `Cannot find package 'sqlite-vec'` | `npm install sqlite-vec` (only lesson 5.4 needs it) |
| `ExperimentalWarning: SQLite is an experimental feature` | Harmless |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
