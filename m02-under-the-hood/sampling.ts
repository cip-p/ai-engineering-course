// Lesson 2.3: your own sampler.
//
// The model only produces scores (logits). Everything that turns those scores into
// one chosen token is plain arithmetic, and it lives in this file.
//
// Check your work:  npx tsx --test m02-under-the-hood/sampling.test.ts

export type SamplingOptions = { temperature: number; topK?: number; topP?: number };

// Turn logits into probabilities: all positive, adding up to 1.
export function softmax(logits: ArrayLike<number>): Float64Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);

  const probs = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    probs[i] = Math.exp(logits[i] - max); // subtracting the max avoids overflow and doesn't change the result
    sum += probs[i];
  }
  for (let i = 0; i < probs.length; i++) probs[i] /= sum;
  return probs;
}

// Token ids, from most to least likely.
export function rankByProbability(probs: ArrayLike<number>): number[] {
  return Array.from({ length: probs.length }, (_, id) => id).sort((a, b) => probs[b] - probs[a]);
}

// Greedy: always the single most likely token. This is what temperature 0 means.
export function greedy(probs: ArrayLike<number>): number {
  let best = 0;
  for (let id = 1; id < probs.length; id++) if (probs[id] > probs[best]) best = id;
  return best;
}

// Draw one token at random, where each token's chance equals its probability.
// Picture the probabilities laid end to end along a line from 0 to 1: pick a random
// point on the line and return the token it lands on.
export function pickRandom(probs: ArrayLike<number>, random: () => number = Math.random): number {
  let point = random();
  for (let id = 0; id < probs.length; id++) {
    point -= probs[id];
    if (point < 0) return id;
  }
  return probs.length - 1; // only reached through floating-point rounding
}

// TODO 1: divide every logit by the temperature, and return the result as a NEW array.
// This shrinks (temperature > 1) or stretches (temperature < 1) the gaps between scores,
// and softmax turns those gaps into probability ratios, so the distribution flattens or sharpens.
export function applyTemperature(logits: ArrayLike<number>, temperature: number): Float64Array {
  throw new Error("TODO 1: implement applyTemperature in m02-under-the-hood/sampling.ts");
}

// Divide by the total, so the probabilities that are left add up to 1 again.
// It's done for you: you'll need it in TODOs 2 and 3.
function rescale(probs: Float64Array): Float64Array {
  const total = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / total);
}

// TODO 2: keep only the k most likely tokens, and return a NEW array: every other token
// gets probability 0, and the kept ones are rescaled. rankByProbability gives you the order.
export function topK(probs: ArrayLike<number>, k: number): Float64Array {
  throw new Error("TODO 2: implement topK in m02-under-the-hood/sampling.ts");
}

// TODO 3: keep the most likely tokens until their probabilities add up to at least p (the
// "nucleus"), and return a NEW array like topK's. Unlike top-k, the number of survivors
// adapts: one token when the favourite alone covers p, many when the model is unsure.
export function topP(probs: ArrayLike<number>, p: number): Float64Array {
  throw new Error("TODO 3: implement topP in m02-under-the-hood/sampling.ts");
}

// The whole pipeline, in the same order Ollama uses: the filters decide which tokens
// may compete, then temperature decides how evenly the survivors compete.
export function sample(logits: ArrayLike<number>, options: SamplingOptions): number {
  let probs = softmax(logits);
  if (options.topK) probs = topK(probs, options.topK);
  if (options.topP) probs = topP(probs, options.topP);
  if (options.temperature === 0) return greedy(probs);

  // Temperature works on logits, so turn the probabilities back into logits first.
  // log(probability) is a valid logit (softmax ignores a constant shift), and dropped
  // tokens become log(0) = -Infinity, which softmax turns back into 0.
  return pickRandom(softmax(applyTemperature(probs.map(Math.log), options.temperature)));
}
