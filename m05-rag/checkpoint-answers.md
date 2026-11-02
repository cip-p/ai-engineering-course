# Module 5 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the numbers from [Reference results](README.md#reference-results-k--3-qwen34b-instruct-2507-q4_k_m). This file isn't part of the search corpus (only `README.md` is), so it can name the eval questions and their answers without leaking them into the eval.

## 1. Name the steps of the RAG pipeline. Which ones happen once, and which happen for every question?

- **Once, ahead of time:** load the notes → chunk them → embed every chunk → store the vectors (plus a BM25 index).
- **For every question:** embed the question → retrieve the top k (embeddings and BM25, fused with RRF) → build the prompt (instructions, then the numbered sources, then the question) → generate an answer with citations.

"Once" really means "whenever the documents change". The cache re-embeds only chunks whose text changed. That's what the "Embedding 4 chunks" lines were after each doc edit.

## 2. Your RAG gives a wrong answer. How do you tell whether retrieval or generation failed?

Check whether the right source was in the prompt (`--show-prompt`, or the eval's "source found" column):
- If it wasn't, **retrieval** failed.
- If it was and the answer is still wrong, **generation** failed.

This only works if you've labelled where each answer lives, and the label has to be precise enough. r08 at 400 characters was labelled GENERATION, but the model had the right *section* and the wrong *piece*: one about embeddings and negation, not the one about RRF. So when the label says generation, read the actual chunks before trusting it.

There's also a third kind of failure: a question the notes can't answer, which the model answers anyway (a hallucination).

## 3. Smaller vs. bigger chunks: what do you gain and lose either way?

**Small chunks (400 characters):**
- **Gain:** they match more precisely. They found q04 and r03, which the big sizes missed.
- **Gain:** they're cheap: ~245 prompt tokens against ~600 for whole sections, so about 3 s of prefill instead of 7–8.
- **Lose:** context. The model fills the gaps itself. At 400 you got two confident wrong answers (r08, r11), plus r01's invented "consistent across platforms".
- **Caution:** hit@3 flatters them. 5.1 scored them 90%, and they still ended at 8/12.

**Big chunks (whole sections):**
- **Gain:** they keep the context.
- **Lose:** they blur several topics into one vector (whole sections missed r03), and they cost the most tokens.

**800 sat in the middle:** 8/12, zero wrong answers, and the fastest run. That's the setup you'd ship.

## 4. Why does k affect both answer quality and speed on your machine?

- **Quality:** a bigger k gives the right chunk more chances to get in. r11's right source was #5 in the embeddings ranking, so k = 5 might catch it. But every extra chunk is also on-topic text the model can improvise from.
- **Speed:** every chunk is prompt your CPU must read before the first word. One 800-character chunk is ~140 tokens, about 1.7 s at ~80 tokens/s. On a GPU that would barely matter. On your machine it's most of the wait.

## 5. How does the model "know" to say "I don't know"? Why is that unreliable, and what else could you do?

It only says it because the system prompt tells it to. It's following an instruction, not running a check. The model has to judge whether the sources really contain the answer, and a 4B model is bad at that when the sources are *on topic*. r11 made up a cited answer at two of the three chunk sizes. The pizza refusal didn't follow the exact format either.

What else you could do:
- **Before generating:** a gate on the similarity score (exercise 3). Your numbers show its limit: r09 scored 0.71 with no answer in the notes, as high as the answerable questions. A better option is a relevance check (a reranker, or a model asking "does this chunk answer the question?").
- **After generating:** check the citations (exercise 4). Better still, require a word-for-word quote from a source, and check in code that the quote really is in that source.
- **At the source:** clean the corpus (exercise 8), so that text which only resembles the question never reaches the model.

## 6. What does a vector database add over Module 4's arrays? When would you need approximate search?

**What it adds:**
- **Persistence:** the index survives restarts.
- **Updates:** inserts and deletes without rebuilding everything.
- **SQL and metadata filters next to the vectors.** Filter *during* the search: filtering after taking the top k leaves you with fewer than k.

The arithmetic is the same: sqlite-vec's top 5 matched your hand-written search to three decimals.

**You'd need approximate search** (HNSW and similar) when comparing the question with every vector gets too slow, roughly at hundreds of thousands to millions of vectors. It trades a little recall for a lot of speed. At ~120 chunks the search takes microseconds, and your time goes into the prompt (~7 s) and the answer (~7 s).
