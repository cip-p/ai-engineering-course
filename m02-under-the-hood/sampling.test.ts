// Checks for your sampler.  Run:  npx tsx --test m02-under-the-hood/sampling.test.ts
//
// The toy distribution is the coffee-shop example from Module 1:
// "Mocha" 60%, "Brew" 25%, "Morning" 15%.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTemperature, pickRandom, softmax, topK, topP } from "./sampling";

const PROBS = [0.6, 0.25, 0.15];
const LOGITS = PROBS.map(Math.log);

function assertClose(actual: ArrayLike<number>, expected: number[]) {
  assert.equal(actual.length, expected.length, "wrong length");
  expected.forEach((value, i) => {
    assert.ok(Math.abs(actual[i] - value) < 0.001, `position ${i}: expected ${value}, got ${actual[i]}`);
  });
}

test("softmax turns the logits back into the original probabilities", () => {
  assertClose(softmax(LOGITS), PROBS);
});

test("pickRandom returns the token under the random point", () => {
  assert.equal(pickRandom(PROBS, () => 0.1), 0); // 0.1 falls in Mocha's stretch, 0–0.6
  assert.equal(pickRandom(PROBS, () => 0.7), 1); // 0.7 falls in Brew's stretch, 0.6–0.85
  assert.equal(pickRandom(PROBS, () => 0.9), 2); // 0.9 falls in Morning's stretch, 0.85–1
});

test("TODO 1: temperature 1 changes nothing", () => {
  assertClose(softmax(applyTemperature(LOGITS, 1)), PROBS);
});

test("TODO 1: temperature 0.5 sharpens", () => {
  assertClose(softmax(applyTemperature(LOGITS, 0.5)), [0.809, 0.14, 0.051]);
});

test("TODO 1: temperature 1.5 flattens", () => {
  assertClose(softmax(applyTemperature(LOGITS, 1.5)), [0.512, 0.285, 0.203]);
});

test("TODO 1: leaves its input untouched", () => {
  const input = [...LOGITS];
  applyTemperature(input, 0.5);
  assert.deepEqual(input, LOGITS);
});

test("TODO 2: top-k 2 drops Morning and rescales the rest", () => {
  assertClose(topK(PROBS, 2), [0.706, 0.294, 0]);
});

test("TODO 2: top-k 1 keeps only the favourite", () => {
  assertClose(topK(PROBS, 1), [1, 0, 0]);
});

test("TODO 2: works when the tokens aren't in order", () => {
  assertClose(topK([0.15, 0.6, 0.25], 1), [0, 1, 0]);
});

test("TODO 2: leaves its input untouched", () => {
  const input = [...PROBS];
  topK(input, 1);
  assert.deepEqual(input, PROBS);
});

test("TODO 3: top-p 0.5 keeps only Mocha (its 60% already covers 50%)", () => {
  assertClose(topP(PROBS, 0.5), [1, 0, 0]);
});

test("TODO 3: top-p 0.8 keeps Mocha and Brew (together 85%)", () => {
  assertClose(topP(PROBS, 0.8), [0.706, 0.294, 0]);
});

test("TODO 3: top-p 0.9 needs all three (85% isn't enough)", () => {
  assertClose(topP(PROBS, 0.9), PROBS);
});

test("TODO 3: works when the tokens aren't in order", () => {
  assertClose(topP([0.15, 0.6, 0.25], 0.5), [0, 1, 0]);
});

test("TODO 3: leaves its input untouched", () => {
  const input = [...PROBS];
  topP(input, 0.5);
  assert.deepEqual(input, PROBS);
});
