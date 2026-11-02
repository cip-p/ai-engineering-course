# Module 10 (elective): Inference optimization

*Book: chapter 9 (inference optimization)*

**Goal:** measure what makes a model fast or slow on your own machine, and what each speed-up costs. Quantization trades bits for speed and memory. The context length costs memory through the KV cache. Batching trades one user's latency for everyone's throughput. Everything is measured with Ollama, on the course model, with the eval harness from Module 3.

## Concepts (read before running anything)

1. **Two phases, two bottlenecks** (Module 1 met them):
   - **Prefill** reads the prompt, every token at once. Each weight is read from memory once and used for many tokens, so the processor's arithmetic is the limit: prefill is **compute-bound**.
   - **Decode** writes the answer one token at a time, and every token reads *all* the weights once. Memory bandwidth is the limit: decode is **memory-bound**, and its speed is roughly bandwidth ÷ model size.

   So shrinking the model should speed up decode almost in proportion, and prefill much less. Lesson 10.5 checks it.

2. **Quantization** stores each weight in fewer bits. The three builds of the course model:

   | Build | Bits per weight | What it is |
   |---|---|---|
   | `fp16` | 16 | The model as released (`F16`): no quantization |
   | `q8_0` | 8.5 | 8-bit integers, with one 16-bit scale per block of 32 weights |
   | `q4_K_M` | ~5 | Mostly 4-bit, in blocks with scales of their own. "M" (medium) keeps some sensitive tensors at 6 bits. The course default |

   Fewer bits make a smaller file, which means less memory, a faster load and a faster decode. The cost is rounding: every weight is slightly off, so every logit is slightly off, and now and then a different token wins. Whether that matters depends on the task, so it has to be measured on yours (book ch. 9). This is **weight-only** quantization: the arithmetic still happens at higher precision, after the weights are expanded back.

3. **The KV cache.** To write token *n*, attention looks back at every earlier token's *key* and *value* vectors, at every layer. Computing them once and keeping them is the KV cache. Without it, every step would redo the whole prompt. Its size per token is:

   ```
   layers × KV heads × (key size + value size) × bytes per number
   ```

   **Grouped-query attention** (GQA) lets several query heads share one KV head, which shrinks the cache. Qwen3 4B has 32 query heads and 8 KV heads. Ollama allocates the cache for the **whole context** when it loads the model, so a bigger `num_ctx` costs memory whether you fill it or not. The prompt cache from Module 1 is this same KV cache, kept between requests.

4. **The context window is a hard limit, enforced by the server,** not by the model. When a prompt doesn't fit, something has to give: the server refuses it with an error, or it silently drops part of the prompt (older Ollama versions did, and some servers still do). Lesson 10.7 shows what your Ollama does.

5. **Latency vs. throughput.** One user cares about *latency*: time to first token (TTFT) and tokens per second. A service cares about *throughput*: the total tokens per second across all users, which sets the cost per token. Because decode is memory-bound, decoding several sequences together costs little more per step than decoding one: the weights are read once and used for all of them. That's **batching**. Ollama runs one request per model at a time unless `OLLAMA_NUM_PARALLEL` allows more, and each parallel slot needs its own KV cache.

6. **What else exists,** and isn't measured here: speculative decoding (a small model drafts, the big one checks several tokens in one pass), flash attention, paged attention and continuous batching (vLLM), distillation and pruning, and hardware. The book's chapter 9 covers them. The measurements here teach you to judge any of them the same way: what does it buy, and what does it cost?

## Setup

```bash
ollama pull qwen3:4b-instruct-2507-q8_0     # ~4.3 GB
ollama pull qwen3:4b-instruct-2507-fp16     # ~8.1 GB
```

That's about 12.4 GB of disk. The fp16 build needs about 8.7 GB of memory when loaded. **With 8 GB of RAM,** skip fp16 and compare `q4_K_M` with `q8_0` (pass `--models` to each script), or use the same three builds of `llama3.2:3b`. When you're done, `ollama rm` the builds you don't need.

| File | What it is |
|---|---|
| `ollama.ts` | Ollama's native API: per-phase timings, the memory a loaded model uses, and the model's shape |
| `quant-bench.ts` | Lesson 10.5: size, memory, load time, prefill and decode speed of each build |
| `quant-eval.ts` | Lesson 10.6: Module 3's tickets and problems on each build, and how often each agrees with fp16 |
| `kv-cache.ts` | Lesson 10.7: the KV cache, predicted and measured, and a prompt that doesn't fit |
| `parallel.ts` | Lesson 10.8: 1, 2, 4 and 8 requests at once |

Changes outside this folder:
- `m03-prompting-evals/tickets.ts` and `problems.ts` hold Module 3's tasks, so that this elective runs them unchanged;
- `common/evals.ts` records `tokensIn` with each output, and widens the report's first column for long variant names.

## Lesson 10.5: Size and speed (`quant-bench.ts`)

```bash
npx tsx m10-inference/quant-bench.ts
```

Each build is loaded on its own, then timed on a long prompt (prefill) and on a long answer (decode), three times. It takes about 20 minutes on a CPU, 6 of them rests: a laptop slows down under sustained load, compute-bound prefill most of all, so every measurement starts after 20 seconds of rest.

**What to notice**
- **`bits/weight`:** the file size × 8 ÷ the parameter count. Is `q4_K_M` really 4 bits?
- **`memory` minus `file`:** what loading adds on top of the weights. Lesson 10.7 explains most of it.
- **`read/s`:** file size × decode tokens/s. If decode is memory-bound, this is about the same for every build: your machine's memory bandwidth, as decode uses it.
- **`decode … (size alone predicts …)`:** does halving the bytes double the speed?
- **`prefill`:** does it follow the size the way decode does?
- **The ranges in brackets.** How much do three runs of the same measurement disagree?

## Lesson 10.6: Quality (`quant-eval.ts`)

```bash
npx tsx m10-inference/quant-eval.ts
```

Module 3's 20 tickets (the `definitions` prompt) and six reasoning problems (`cot`), on each build. That's about 15 minutes on a CPU, most of it fp16 writing out its reasoning. Then each build is compared with fp16, answer by answer.

**What to notice**
- **The scores.** Can 20 tickets and 6 problems tell the builds apart at all?
- **`same category` and `same text`.** Agreement with fp16 is a finer measure than a score: it counts every changed answer, right or wrong.
- **`first difference`:** how many characters two builds stay identical before they part. Add `--verbose` to see the token where they split, and whether they reach the same number anyway.
- **Time per answer,** next to lesson 10.5's decode speed.

## Lesson 10.7: The KV cache (`kv-cache.ts`)

```bash
npx tsx m10-inference/kv-cache.ts
```

**What to notice**
- **Part 1, the prediction.** Work out one token's cache size from the shape it prints, then check the total for the model's full context. Would it fit in your memory?
- **Part 2, the measurement.** The model is loaded with 4,096 to 32,768 tokens of context, and nothing else changes. Compare the memory's growth with the prediction, and the measured `per extra token` with Part 1.
- **Part 3, a prompt longer than the context.** At 2,048 tokens, what did Ollama do with it? At 4,096, did the model find the fact in the first line, and how long did reading 2,700 tokens take?
- **Part 3's `writing` column:** decode with a short prompt, and with 2,700 tokens of context.

## Lesson 10.8: Batching (`parallel.ts`)

First against your normal server:

```bash
npx tsx m10-inference/parallel.ts
```

Then start a **second Ollama server** with four parallel slots, on another port, in a second terminal. It uses the same downloaded models, and your normal server keeps running:

```bash
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_NUM_PARALLEL=4 ollama serve
```

In PowerShell:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11435"; $env:OLLAMA_NUM_PARALLEL = "4"; ollama serve
```

Then, in the first terminal:

```bash
ollama stop qwen3:4b-instruct-2507-q4_K_M     # so only one copy is in memory
npx tsx m10-inference/parallel.ts --url http://localhost:11435
```

Stop the second server with Ctrl+C when you're done.

**What to notice**
- **One slot:** do the requests run together or take turns? Look at the median and the slowest latency as the batch grows.
- **Four slots:** `each decodes at` (one user's speed) against `total output` (everyone's). Which one batching improves, and which one it costs.
- **Eight requests on four slots:** the extra four wait. What happens to the slowest latency?
- **The memory line at the top** for each server. Four slots of 4,096 tokens: compare it with lesson 10.7's 16,384-token load.

## Exercises

1. **A second model family.** Run `quant-bench.ts --models llama3.2:3b` and a quantization of your choice from its tags page. Does the bandwidth figure (`read/s`) stay the same across families?
2. **Where quantization hurts.** Find a task where `q4_K_M` scores worse than `q8_0`. Try lesson 3.3's `instruct` prompt (one number, no room to reason), long multilingual text, or exact copying of a long code block. Use `quant-eval.ts`'s agreement table to find candidates.
3. **Quantize the cache.** Start the second server with `OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0`, then run `kv-cache.ts --url http://localhost:11435 --cache-type q8_0`. Does the memory follow the new prediction? Run lesson 10.6's tickets against that server (`--url`): do the answers change?
4. **Fit the context on purpose.** Ollama refused the prompt that didn't fit. Make Part 3 handle it the way an app should: before sending, estimate the prompt's tokens (about 4 characters per token, Module 1) and leave room for the answer; if it doesn't fit, shorten the filler, never the fact or the question. How would a RAG app (Module 5) apply the same rule to its retrieved chunks?
5. **Throughput vs. latency, in money.** From your lesson 10.8 numbers, how many users could this laptop serve at 5 tokens/s each? What would you set `OLLAMA_NUM_PARALLEL` to for a team of ten, and what does it cost in memory?
6. **The thinking build.** Run lesson 10.5 on `qwen3:4b`. It's the same size, so the speed should match. Then count the tokens it spends thinking (Module 3) and work out its real time to an answer.

## Checkpoint (answer in your own words)

1. Why does decode speed follow the model's size, and prefill not as much? Use your numbers.
2. What does quantization trade, and how would you decide whether `q4_K_M` is good enough for an app?
3. Why is "agrees with fp16" a better measure of quantization damage than a score on 20 cases?
4. What is the KV cache, what decides its size, and why does a bigger `num_ctx` cost memory even when the prompt is short?
5. What happened to the prompt that didn't fit in the context? Why is that dangerous in a RAG app?
6. Batching raised throughput. What did it cost, and who pays that cost?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (Intel i7 laptop, 16 GB, CPU only, Ollama 0.40.6)

The author's numbers, from a 6-core Intel i7 laptop with 16 GB and no GPU, with the apps of a normal working day open. Compare the shape, not the digits.

| Measurement | Value |
|---|---|
| 10.5, the files | q4_K_M 2.50 GB (5.0 bits per weight) · q8_0 4.28 GB (8.5) · fp16 8.05 GB (16.0) |
| 10.5, memory when loaded | 3.19 · 4.97 · 8.74 GB: the file plus the same 0.69 GB each |
| 10.5, loading | 4.8 · 6.6 · 17.5 s |
| 10.5, decode, median (range of 3 runs) | 8.9 (8.7–9.3) · 6.0 (4.1–6.5) · 3.2 (3.2–3.3) tokens/s |
| 10.5, decode against size | q8_0 0.67× q4_K_M's speed (its size alone predicts 0.58×) · fp16 0.36× (0.31×) |
| 10.5, bandwidth decode used | 22 · 26 · 26 GB/s |
| 10.5, prefill, 1,024 tokens | 39.3 (33.7–53.0) · 26.1 (23.4–27.7) · 23.7 (18.7–28.1) tokens/s: 0.66× and 0.60× q4_K_M's |
| 10.5, the same benchmark without the rests | q4_K_M's prefill ranged from 17.3 to 51.5 tokens/s in three runs of the same thing, and q8_0's decode from 2.8 to 5.3 across four runs |
| 10.6, tickets | 20/20 for all three builds, every category the same as fp16's · 0.8 · 1.6 · 1.9 s per ticket |
| 10.6, problems | 5/6 for all three (all missed `strawberry`) · 23.7 · 37.3 · 56.3 s per problem |
| 10.6, problems, compared with fp16 | the same text: q4_K_M 0/6, q8_0 4/6 · the same final number: 6/6 for both |
| 10.6, where the texts first differed | q4_K_M after 0, 0, 12, 29, 90 and 110 characters · q8_0 after 29 and 171 |
| 10.7, the prediction | 147,456 bytes (144 KiB) per token: 0.60 GB for 4,096 tokens, 4.83 GB for 32,768, 38.65 GB for the full 262,144 |
| 10.7, the measurement | 3.19 GB at 4,096 tokens, 3.89 at 8,192, 5.11 at 16,384, 7.56 at 32,768: 149–168 KiB per extra token |
| 10.7, a 2,639-token prompt in a 2,048-token context | refused: HTTP 400, "request (2639 tokens) exceeds the available context size (2048 tokens)" |
| 10.7, the same prompt in 4,096 tokens | read in 128 s, and the fact found ("4719") |
| 10.7, decode with a short prompt and with 2,639 tokens of context | 9.7 and 4.0 tokens/s |
| 10.8, one slot (Ollama's default) | 1, 2, 4 and 8 requests: the last one done after 9.0, 16.9, 34.8 and 83.0 s; total output 8.9, 9.4, 9.2 and 7.7 tokens/s |
| 10.8, four slots | 5.09 GB in memory (1.90 GB more) · 1, 2, 4 requests: each decodes at 9.6, 7.7, 7.4 tokens/s; total 9.2, 14.6, 26.2 tokens/s (2.8×) |
| 10.8, eight requests on four slots | first done after 12.2 s, last after 27.2 s; 23.5 tokens/s in total |
| 10.8, the same eight, run straight after the other batches | the last done after 82.1 s, each decoding at 2.3 tokens/s |
| Exercise 3, a q8_0 cache (with flash attention) | the cache took 306 MiB for 4,096 tokens, exactly the prediction (77 KiB per token); 2.90 GB loaded at 4,096 tokens, 5.30 GB at 32,768. Prefill slowed to 8–10 tokens/s, and the 2,639-token prompt didn't finish within Node's 5-minute limit |

Another app competing for the CPU moves these numbers more than anything in the lessons: one run of lesson 10.8's one-slot server, while a screen-sharing session took about half a core, needed 155.6 s for the eight requests instead of 83.0.

**What these runs showed**
- **Decode follows the size.** All three builds read their weights at 22–26 GB/s, so fewer bytes meant proportionally more tokens per second, and the big builds came out slightly ahead of the prediction. q4_K_M read the least per second: unpacking 4-bit blocks costs some arithmetic too.
- **Prefill doesn't.** fp16 has 3.2× q4_K_M's bytes, and prefilled at 0.60× its speed, while decoding at 0.36×. Prefill is arithmetic, and how fast it runs depends on the CPU's support for each format.
- **A laptop needs a measurement protocol.** Run back to back, the same prefill measurement ranged threefold, because heat and power limits slow a laptop under sustained load. With a 20-second rest before each request, decode stayed within a few percent. Batched decode, the most arithmetic per weight read, was the most sensitive: the same eight requests took 27.2 s rested and 82.1 s after other work.
- **Quantization cost no score here, and agreement found what changed.** All three builds scored the same on both tasks. Compared answer by answer, q8_0 wrote fp16's exact text on four of six problems, and q4_K_M on none: two of its answers already differed in the first word. Every build still reached fp16's final numbers. A 26-case score couldn't see quantization at all; agreement could.
- **Memory is the weights plus the cache.** Every build took its file size plus the same 0.69 GB: a 4,096-token cache (0.60 GB) and some buffers. At every step of Part 2 the memory grew 0.10–0.15 GB more than the formula said (buffers that grow with the context too), and a 32,768-token context cost more memory than the 4-bit weights themselves.
- **Ollama refused the prompt that didn't fit.** Version 0.40.6 returns an error, which is the safe failure: an app sees it. Older versions silently dropped the start of the prompt, which here would have been the fact.
- **Long contexts are slow on a CPU.** Reading 2,639 tokens took 128 s, and then each new token took more than twice as long as with a short prompt. That's more than the 380 MB of extra cache read per token explains (on top of 2.5 GB of weights): attention over a long context is arithmetic too, and the CPU was hot after two minutes of prefill.
- **Batching buys throughput with memory and per-user speed.** Four slots took 1.9 GB more (four 4,096-token caches) and gave 2.8× the total output, while each request decoded about a quarter slower. With one slot, requests just queued: throughput stayed flat, and the last of eight waited 83 s. With four slots, the fifth to eighth requests waited for a whole wave.
- **A quantized cache traded speed for memory.** The q8_0 cache halved the cache's memory, exactly as predicted. On this CPU, with flash attention, prefill became several times slower.

## Troubleshooting

| Problem | Fix |
|---|---|
| `model "…" not found. Pull it first` | Run Setup's `ollama pull`, or pass the builds you have with `--models` |
| fp16 is extremely slow, or the laptop freezes | Not enough free memory: the fp16 build needs about 8.7 GB. Close other apps, or skip it with `--models` |
| The speeds vary a lot between runs | Expected on a laptop: heat, other apps and memory pressure all move them. Compare medians, and rerun with a longer `--pause` |
| `address already in use` when starting the second server | Something already uses port 11435. Pick another port, and pass the same one to `--url` |
| The second server can't find a model | It uses the same model folder only if you start it as the same user. Otherwise `ollama pull` it there (`OLLAMA_HOST=127.0.0.1:11435 ollama pull …`) |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
