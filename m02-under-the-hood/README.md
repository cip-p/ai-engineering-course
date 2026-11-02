# Module 2: Under the hood

*Book: chapter 2 (sampling), plus tokenization from chapters 1–2*

**Goal:** run a model yourself, one step at a time. You'll see its tokens, read its raw scores, and write the code that turns those scores into text.

In Module 1, Ollama did all of this for you. Here you take over everything except the neural network itself.

## Concepts (read before running anything)

1. **The tokenizer** converts text into token ids and back. Its vocabulary (about 150,000 pieces for Qwen3) was learned from training data: character sequences that appear often became single tokens. A common word is usually one token. Rare words, code symbols, other languages and numbers break into more pieces.

2. **A forward pass** is one run of the network. You feed in a sequence of ids, and for every position the model returns one score per vocabulary token. These scores are **logits**: unbounded numbers where higher means "more likely to come next". For generation, only the last position matters.

3. **Softmax** turns logits into probabilities: take `e^logit` for each token, then divide by the total, so that everything adds up to 1. Bigger logit gaps become much bigger probability gaps.

4. **Sampling** picks one token from those probabilities:
   - greedy (always the top one), or
   - at random, shaped by temperature and filtered by top-k / top-p.

   The chosen token is appended to the sequence and the model runs again. **Generation is just this loop.**

5. **Why small models hallucinate.** Whatever you ask, the model always produces a probability for *every* next token. There is no built-in "I don't know" token. It continues with something plausible-looking, and a smaller model has less knowledge to make "plausible" also mean "true". In lesson 2.2 you'll see this happen in the numbers.

## The model: Qwen3-0.6B

- **Same family and same tokenizer** as your course model, at about a seventh of the size.
- **ONNX format,** which is what Transformers.js runs, with 8-bit weights (about 620 MB).
- **It is not the same network** as your Qwen3 4B, so its probabilities differ. The mechanics are identical.

## Setup (once)

```bash
npm install @huggingface/transformers
```

**Why `package.json` pins `onnxruntime-node`:** Transformers.js runs models with ONNX Runtime, which needs a native binary for your platform. From version 1.24 on, ONNX Runtime ships only Apple Silicon binaries for macOS. So `package.json` has an `overrides` entry that pins `onnxruntime-node` to **1.23.2**, the last release with Intel Mac binaries. That release has Apple Silicon and Linux binaries too, so the pin is harmless everywhere else.

The first run of each script downloads what it needs into `.cache/transformers/`, which is gitignored. Lesson 2.1 needs only the tokenizer (a few MB); lessons 2.2 and 2.4 need the model (about 620 MB, once). Public models don't need a Hugging Face account or token.

## Lesson 2.1: Tokens (`tokens.ts`)

```bash
npx tsx m02-under-the-hood/tokens.ts
```

**What to notice**
- **Spaces belong to the next word** (`│ cat│ sat│`). " cat" and "cat" are different tokens.
- **Long or rare words split into pieces.** Compare "Unbelievably" with "antidisestablishmentarianism".
- **Code spends tokens on symbols.**
- **French needs more tokens per character than English.** Accented letters may even split into byte pieces (`�`).
- **Look at how the numbers are split.** It hints at why LLMs are bad at arithmetic: they never see "12345" as a number.
- **Each emoji takes several tokens.**
- **`<|im_start|>` and `<|im_end|>` are single special tokens.** These are the chat-template markers from Module 1. They aren't text the model reads letter by letter.

Try your own text: `npx tsx m02-under-the-hood/tokens.ts "your text"`

## Lesson 2.2: One prediction (`next-token.ts`)

```bash
npx tsx m02-under-the-hood/next-token.ts "The capital of France is the city of"
npx tsx m02-under-the-hood/next-token.ts --chat "Invent a name for a new coffee shop. Reply with the name only."
npx tsx m02-under-the-hood/next-token.ts "The capital of Australia is the city of"
```

**What to notice**
- The model scored **every** token in its vocabulary. For France, one token (" Paris") takes over half of the probability, and the top 10 cover most of the rest.
- **Logits vs. percentages:** a gap of a few logit points turns into a large gap in probability. That's softmax at work.
- **The coffee-shop prompt:** these are the real first-token probabilities, the numbers we guessed at in Module 1. They come from the 0.6B model, though, not your 4B one.
- **Australia:** the top candidate is a wrong answer, and the right one (Canberra) may not make the top 10 at all. That's a hallucination before it happens, visible as a number. Compare how spread out the probabilities are with the France prompt.
- **Why "is the city of"?** Try plain `"The capital of France is"`: the top candidates are words like " the" and " located", because many sentences continue that way. Without the chat template (`--chat`), the model just continues the text; it isn't answering a question. The prompt decides what the next token is *about*.

## Lesson 2.3: Your sampler (you write the code)

Open `sampling.ts`. `softmax`, `rankByProbability`, `greedy` and `pickRandom` are done; read them first. Then implement the three TODOs:

1. **`applyTemperature`**: divide every logit by the temperature.
2. **`topK`**: keep the k most likely tokens and rescale them.
3. **`topP`**: keep the most likely tokens until they cover p, and rescale.

Check your work with:

```bash
npx tsx --test m02-under-the-hood/sampling.test.ts
```

At first the TODO tests fail with "TODO 1: implement…". Work through them until all pass. The tests use the coffee-shop numbers from Module 1 (60% / 25% / 15%), so you can check the expected values by hand.

**TypeScript tips**
- `new Float64Array(n)` creates an array of `n` zeros.
- `Float64Array.from(source, (x) => ...)` creates a new array by transforming each element.
- Every TODO says **NEW array**: don't change the input (remember `splice` vs. `slice`). The tests check this.

**Afterwards**, rerun lesson 2.2 with `--temperature 0.5` and then `--temperature 1.5`. The logits column stays the same, and only the percentages move.

## Lesson 2.4: Generation (`generate.ts`)

Greedy decoding works right away, because it doesn't use your TODOs:

```bash
npx tsx m02-under-the-hood/generate.ts
npx tsx m02-under-the-hood/generate.ts --trace
```

Once your sampler passes the tests:

```bash
npx tsx m02-under-the-hood/generate.ts --temperature 0.8 --top-p 0.9 --trace
npx tsx m02-under-the-hood/generate.ts --temperature 1.5 --trace
```

**What to notice in `--trace`**
- **The model's probability for each token it picked.** Greedy always takes the top one, while random sampling sometimes takes a long shot, and the whole rest of the answer changes after it.
- **The time per step grows.** This loop has **no KV cache**: every step pushes the whole sequence through the model again, so each step is a little longer than the last. Ollama keeps the cache (Module 1, lesson 1.3), so its time per token stays almost flat.

## Exercises

1. **Your language.** Tokenize the same sentence in English and in another language you speak. Compare the tokens per word. What does that mean for cost, speed and how much fits in the context window? (Book ch. 2 discusses this.)
2. **Make greedy loop.** Find a prompt where greedy decoding repeats itself.
   *Hint: use `--raw` with a repetitive start, such as `--raw --prompt "I like cats. I like dogs. I like"`.*
3. **Break the loop.** Run the same prompt with `--temperature 0.8 --top-p 0.9`. Does the loop break? Why might it?
4. **Hallucination by numbers.** Use `next-token.ts` on a fact the 0.6B model probably doesn't know well (an obscure capital, a minor historical date). How spread out are the probabilities, compared with "The capital of France is the city of"?
5. **Pipeline order.** `sample()` applies the filters first and temperature second, which is Ollama's order. Hugging Face's Python library does it the other way round. With 60/25/15, top-p 0.5 and temperature 1.5, work out on paper whether the order changes which tokens survive. *(Use the table from Module 1, where temperature 1.5 gave 51% / 29% / 20%.)*

## Checkpoint (answer in your own words)

1. What is a logit, and how does softmax turn logits into probabilities?
2. Why does temperature divide the **logits** rather than the probabilities?
3. What does top-p do that temperature can't, and what can temperature do that top-p can't?
4. Why can't a small model simply say "I don't know" when it doesn't know?
5. Why does generation without a KV cache get slower with every token?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (Intel i7 laptop, 16 GB, CPU only, Qwen3-0.6B at 8 bits)

| Measurement | Value |
|---|---|
| First run's download | 601 MB into `.cache/transformers` |
| An English sentence | 3.3 characters per token: "The cat sat on the mat." is 7 |
| The same request in French and in English | 16 tokens against 10 |
| A five-digit number | 5 tokens, one per digit |
| Each emoji | 2 tokens, each holding part of a character (`�`) |
| `"The capital of France is"` | `" the"` 12.8%, `" in"` 11.2%; `" Paris"` 8th, at 1.6% |
| `"…France is the city of"` | `" Paris"` 56.5%; the top 10 cover 77.8% |
| `"…Australia is the city of"` | `" Sydney"` 21.2%, then Melbourne, Brisbane and Darwin; no Canberra in the top 10, which cover 46.3% |
| `" Paris"` at temperature 0.5 / 1 / 1.5 | 97.2% / 56.5% / 11.5%, from the same logit, 17.12 |
| Time per step in `generate.ts` | 149 ms at step 2, 288 ms at step 40, with an 11-token prompt |
| Exercise 2's prompt, greedy | the same two sentences for all 40 tokens, each repeat more likely than the last (up to 95%) |
| The same prompt at temperature 0.8, top-p 0.9, 3 runs | two left the loop for new sentences; one fell into a new loop, "I like dogs." |
| Temperature 1.5, no filter | by step 30 it was picking pieces of Korean, Chinese and Hebrew that the model gave about 0% |

**What these runs showed**
- **The prompt decides what the next token is about.** Asked plainly, the model spread its bets over words that continue a sentence. With "is the city of", one city took over half of the probability.
- **A wrong answer can lead before it's written.** For Australia the favourite was Sydney, and the right answer wasn't in the top 10. Greedy decoding would have printed it with no sign of doubt.
- **Temperature reshapes, it doesn't rescore.** The logit stayed 17.12 at every temperature; only the percentages moved.
- **Tokenization isn't neutral.** French took 1.6 times the tokens of the same request in English, and a number is a row of separate digits.
- **Repetition feeds itself.** In the greedy loop, every repeat made the next one more likely. Sampling with top-p broke it in two runs out of three, and the third found a new loop. With no filter at 1.5, sampling wandered into tokens the model gave almost no chance.
- **Without a KV cache, each step costs more than the last.** Step time nearly doubled over 40 tokens. Ollama keeps the cache, so its time per token stays almost flat (Module 1).

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing printed for a while on the first run | It's downloading about 620 MB; a progress line should appear for the `.onnx` file |
| `Cannot find package '@huggingface/transformers'` | Run the `npm install` from Setup, from the repo root |
| `TODO 1: implement applyTemperature…` | Expected until you write that function in `sampling.ts` |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
