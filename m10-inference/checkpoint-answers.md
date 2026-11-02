# Module 10 (inference) checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the runs in [Reference results](README.md#reference-results-intel-i7-laptop-16-gb-cpu-only-ollama-0406). This file isn't part of the search corpus (only `README.md` is), so it can quote the cases.

## 1. Why does decode speed follow the model's size, and prefill not as much? Use your numbers.

**Decode** writes one token at a time, and each token needs every weight once, so every token reads the whole model from memory. The arithmetic per weight is small, and the processor waits on memory: decode is **memory-bound**, and tokens per second ≈ bandwidth ÷ model size. In the author's runs all three builds read 22–26 GB/s while decoding, so the speed followed the size: fp16, with 3.2× q4_K_M's bytes, decoded at 0.36× its speed (3.2 against 8.9 tokens/s).

**Prefill** reads the whole prompt in one pass: each weight is read once and used for every prompt token. With a thousand tokens, that's a thousand multiplications per weight read, so the processor's arithmetic is the limit: prefill is **compute-bound**. So the bytes matter much less: fp16 prefilled at 0.60× q4_K_M's speed, where its size alone would predict 0.31×. How fast each format computes depends on the CPU: here q4_K_M was fastest, and q8_0 and fp16 close behind each other.

The same split explains why prefill was the measurement most affected by heat: a hot laptop lowers its clock speed, which slows arithmetic more than memory.

## 2. What does quantization trade, and how would you decide whether `q4_K_M` is good enough for an app?

It trades **precision for bytes**. Every weight is rounded to fewer bits, so the model gets smaller (memory), loads faster (disk), and decodes faster (bandwidth). The price is a small error in every weight, which becomes a small error in every logit, and once in a while a different token wins. After that the two texts go their own ways, even when both are fine.

To decide, treat the quantized build as a new model and **run your own eval on it**, next to a higher-precision build:
- **Your tasks, not a benchmark's:** a quantization that's harmless for classification can hurt long reasoning, exact copying, or another language;
- **Agreement as well as scores:** how often does `q4_K_M` answer differently from fp16, and are those differences right or wrong? A small eval can't tell a 2% drop from noise;
- **The failures:** read the cases where the builds disagree;
- **The gain on your hardware:** memory and speed from lesson 10.5. If q8_0 fits and is fast enough, the question is whether q4_K_M's extra speed is worth any loss at all.

In the author's runs, q4_K_M lost nothing measurable on these tasks: the same 20/20 and 5/6 as fp16, and the same final number on every problem, at 2.8× fp16's decode speed and 37% of its memory. That's evidence for these tasks only; exercise 2 asks you to find one where it does lose.

## 3. Why is "agrees with fp16" a better measure of quantization damage than a score on 20 cases?

A score counts only right and wrong, and 20 cases make it coarse: one case is 5 points, so two builds can differ on several answers and still get the same score (one fixed, one broken), or differ by one case through pure chance.

Agreement compares every answer with the unquantized model's answer, case by case, so it sees every change that quantization made, right or wrong. And for long answers, *where* two texts first differ shows how long the rounding errors stayed invisible before one token flipped.

Agreement alone isn't enough either: a build that disagrees with fp16 might be *more* right. Use both: agreement to find what changed, the score and the failures to judge whether it matters.

The author's runs show it: all three builds scored exactly the same, so the score said "no difference". Agreement said q8_0 wrote fp16's exact text on 4 of 6 problems and q4_K_M on none, two of its answers parting from fp16's at the very first token, and all of them still reaching the same final number. So quantization changed every long answer at 4 bits, and none of the changes mattered for these six problems.

## 4. What is the KV cache, what decides its size, and why does a bigger `num_ctx` cost memory even when the prompt is short?

At every layer, attention compares the new token with every earlier token's **key**, and mixes their **values**. The KV cache stores those keys and values once they're computed, so each new token only computes its own, instead of recomputing the whole context at every step.

Its size per token is **layers × KV heads × (key size + value size) × bytes per number**. For Qwen3 4B that's 36 × 8 × (128 + 128) × 2 bytes = 147,456 bytes, 144 KiB per token, in 16-bit numbers. Grouped-query attention already shrinks it: 32 query heads share 8 KV heads, a quarter of what one KV head per query head would need.

Ollama (llama.cpp underneath) **allocates the cache for the whole context when it loads the model**, so that it never has to grow or move during generation. So `num_ctx` decides the memory, not the prompt: a 32,768-token context reserves 32,768 tokens' worth, even for "hello".

Measured: 3.19 GB at 4,096 tokens, 7.56 GB at 32,768, about 149–168 KiB per extra token: the 144 KiB of the formula, plus buffers that grow with the context. Loaded with its full 262,144 tokens, the 2.5 GB model would need about 41 GB; Ollama's default of 4,096 tokens keeps it near 3 GB. Part of the "memory minus file size" in lesson 10.5 (0.69 GB for every build) is the 4,096-token cache.

## 5. What happened to the prompt that didn't fit in the context? Why is that dangerous in a RAG app?

**Ollama 0.40.6 refused it** with an HTTP 400 error: "request (2639 tokens) exceeds the available context size (2048 tokens)". Nothing was generated. With a 4,096-token context the same prompt was read in 128 s, and the model found the fact in its first line.

An error is the safe way to fail, because the app sees it. Older Ollama versions, and some other servers, **truncate** instead: they silently drop the start of the prompt, and in many apps the start is the system prompt and the instructions.

In a RAG app either one is dangerous, because the prompt's length depends on what was retrieved:
- **With refusal,** the app works for most questions and fails for the few whose retrieved chunks happen to be long, which looks like a random bug;
- **With truncation,** it's worse: the model answers without its instructions or the first sources, confidently, and nothing in the output says so.

The fix is the same for both: count (or estimate) the prompt's tokens before sending it, leave room for the answer, and drop the least relevant chunks until it fits (exercise 4).

## 6. Batching raised throughput. What did it cost, and who pays that cost?

With four slots, four requests decoded together gave **2.8× the total output** (26.2 against 9.2 tokens/s). The costs:
- **Each user's speed:** each request decoded at 7.4 tokens/s instead of 9.6, about a quarter slower. Every user pays a little;
- **Memory:** each slot needs its own KV cache, so four 4,096-token slots took 1.90 GB more (5.09 against 3.19 GB);
- **Waiting, beyond the slots:** the fifth to eighth requests waited for a whole wave, so the last of eight finished after 27.2 s, three times one request's latency;
- **Heat, on a laptop:** batched decode does the most arithmetic per weight read, and run after other work, the same eight requests took 82.1 s.

A service makes this trade on purpose: cost per token falls with throughput, so it batches, and then sets the number of slots so that each user's latency stays acceptable. One user on a laptop is better off with one slot. With one slot (Ollama's default), more users don't add throughput at all: they queue, and the eighth waited 83 s.
