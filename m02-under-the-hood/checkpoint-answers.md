# Module 2 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words). This file isn't part of the search corpus (only `README.md` is), so it doesn't change the Module 4 and 5 evals.

## 1. What is a logit, and how does softmax turn logits into probabilities?

A **logit** is the raw score the network outputs for one vocabulary token at one position. A forward pass gives one logit for *every* token in the ~150,000-token vocabulary. Logits are unbounded, and higher means "more likely to come next".

**Softmax** turns them into probabilities: take `e^logit` for each token, then divide by the total, so everything adds up to 1. Because of the exponential, gaps grow. One logit point apart is a factor of e ≈ 2.7 in probability, and two points is ≈ 7.4. That's why a few logit points in lesson 2.2 became a large gap in percentages.

## 2. Why does temperature divide the logits rather than the probabilities?

Dividing the logits by T scales every *gap* between them, and softmax then turns those gaps into probabilities:
- **T < 1** widens the gaps, so the distribution gets sharper.
- **T > 1** shrinks them, so it gets flatter.
- **T → 0** leaves only the top token, which is greedy. Code treats 0 as "pick the top one" to avoid dividing by zero.

Dividing the *probabilities* by T would do nothing. Every probability shrinks by the same factor, and rescaling them to add up to 1 gives back exactly the same distribution. (Dividing the logits is the same as raising each probability to the power 1/T and then rescaling.)

## 3. What does top-p do that temperature can't, and what can temperature do that top-p can't?

- **Top-p removes tokens.** It keeps the smallest set of top tokens that covers p of the probability, and gives everything else 0. That cuts off the long tail of bad tokens, and it adapts: there are few candidates when the model is confident and many when it isn't. Temperature can never take a token's chance all the way to 0.
- **Temperature changes the odds among the tokens that remain.** It can make the second choice more or less likely relative to the first. Top-p keeps the survivors in their original proportions; it only rescales them.

Module 1's "Mocha Haven" result shows both: `top_p: 0.5` left one candidate, so temperature had nothing left to reshape.

## 4. Why can't a small model simply say "I don't know" when it doesn't know?

At every step, the model outputs a probability for every token, and those probabilities always add up to 1. So something always gets picked. There's no built-in "I don't know" token and no fact check. The model continues the text with whatever looks plausible. "I don't know" is just one possible continuation, and it only comes out if training made it likely in that context.

A small model knows less, so "plausible" is more often false. You can sometimes see the uncertainty as probability spread across several answers (the Australia prompt), but the model doesn't act on it. Module 5 shows the system-level fixes: give it sources, instruct it to refuse, and check the result. Even those are unreliable with a 4B model.

## 5. Why does generation without a KV cache get slower with every token?

Each step pushes the **whole sequence** through the network again: the prompt plus every token generated so far. Step n processes n tokens, so every step does a little more work than the last. That's the growing time per step in `--trace`.

A **KV cache** stores each position's attention keys and values, so a step only computes the new token and looks back at the stored ones. Time per token stays almost flat, which is what Ollama does. The price is memory: the cache grows with the context length.

## Solution: lesson 2.3's sampler

Try the TODOs yourself first: the tests tell you when you're done. One way to write them, in `sampling.ts`:

```ts
export function applyTemperature(logits: ArrayLike<number>, temperature: number): Float64Array {
  return Float64Array.from(logits, (logit) => logit / temperature);
}

export function topK(probs: ArrayLike<number>, k: number): Float64Array {
  const kept = new Float64Array(probs.length); // starts as all zeros
  for (const id of rankByProbability(probs).slice(0, k)) kept[id] = probs[id];
  return rescale(kept);
}

export function topP(probs: ArrayLike<number>, p: number): Float64Array {
  const kept = new Float64Array(probs.length);
  let covered = 0;
  for (const id of rankByProbability(probs)) {
    kept[id] = probs[id];
    covered += probs[id];
    if (covered >= p) break;
  }
  return rescale(kept);
}
```

All three build a new array (`Float64Array.from`, `new Float64Array`) and only read from their input, which is what the "leaves its input untouched" tests check. `topP` stops at the token that takes the total to p or past it, so that token is kept: with 60/25/15 and p = 0.8, Mocha's 60% isn't enough, Brew takes it to 85%, and Morning is dropped.
