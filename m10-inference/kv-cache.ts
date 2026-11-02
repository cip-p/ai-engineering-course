// Lesson 10.7: the KV cache, or why context length costs memory.
//
// Part 1 predicts the cache's size from the model's shape. Part 2 loads the model with
// larger and larger contexts and measures what that really takes. Part 3 sends a prompt
// longer than the context, to see what happens to the part that doesn't fit.
//
// Run:  npx tsx m10-inference/kv-cache.ts                 about 5 minutes on a CPU
//       npx tsx m10-inference/kv-cache.ts --model llama3.2:3b
//       add --url http://localhost:11435 --cache-type q8_0 for a second server with a quantized cache (exercise 3)

import { parseArgs } from "node:util";
import { config } from "../common/llm";
import { filler, gb, ollama } from "./ollama";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: config.model },
    url: { type: "string" },
    contexts: { type: "string", default: "4096,8192,16384,32768" },
    "cache-type": { type: "string", default: "f16" }, // what the server stores the cache as (OLLAMA_KV_CACHE_TYPE)
  },
});
const model = values.model;
const server = ollama(values.url);

// Bytes per stored number. q8_0 and q4_0 keep blocks of 32 numbers plus a 2-byte scale each.
const BYTES: Record<string, number> = { f16: 2, q8_0: 34 / 32, q4_0: 18 / 32 };
const bytesPerValue = BYTES[values["cache-type"]];
if (!bytesPerValue) throw new Error(`--cache-type must be one of ${Object.keys(BYTES).join(", ")}`);

// ─── Part 1: predict ─────────────────────────────────────────────────────────

const { info } = await server.show(model);
const arch = info["general.architecture"];
const layers: number = info[`${arch}.block_count`];
const heads: number = info[`${arch}.attention.head_count`];
const kvHeads: number = info[`${arch}.attention.head_count_kv`] ?? heads;
const headSize: number = info[`${arch}.embedding_length`] / heads;
const keyLength: number = info[`${arch}.attention.key_length`] ?? headSize;
const valueLength: number = info[`${arch}.attention.value_length`] ?? headSize;
const maxContext: number = info[`${arch}.context_length`];

// For every token in the context, every layer keeps one key and one value per KV head.
const perToken = layers * kvHeads * (keyLength + valueLength) * bytesPerValue;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;

console.log(`════ Part 1: the prediction (${model}) ════\n`);
console.log(`per token: ${layers} layers × ${kvHeads} KV heads × (${keyLength} key + ${valueLength} value numbers) × ${bytesPerValue} bytes = ${perToken.toLocaleString()} bytes (${kib(perToken)})`);
if (kvHeads < heads) {
  console.log(`           ${heads} query heads share those ${kvHeads} KV heads (grouped-query attention); one KV head per query head would need ${heads / kvHeads}× as much`);
}
for (const tokens of [4096, 32768, maxContext]) {
  console.log(`  ${tokens.toLocaleString().padStart(8)} tokens → ${gb(perToken * tokens).toFixed(2)} GB${tokens === maxContext ? "  (the most this model accepts)" : ""}`);
}

// ─── Part 2: measure ─────────────────────────────────────────────────────────

console.log(`\n════ Part 2: the measurement ════\n`);
console.log(`${"context".padStart(8)} ${"memory".padStart(9)} ${"growth".padStart(9)} ${"predicted".padStart(10)} ${"per extra token".padStart(16)}`);
let first: { context: number; size: number } | undefined;
for (const context of values.contexts.split(",").map(Number)) {
  await server.unloadAll();
  await server.load(model, context);
  const loaded = (await server.loaded()).find((m) => m.name === model)!;
  first ??= { context: loaded.context_length, size: loaded.size };
  const extraTokens = loaded.context_length - first.context;
  const growth = loaded.size - first.size;
  console.log(
    `${String(loaded.context_length).padStart(8)} ${`${gb(loaded.size).toFixed(2)} GB`.padStart(9)} ` +
      `${`+${gb(growth).toFixed(2)} GB`.padStart(9)} ${`+${gb(extraTokens * perToken).toFixed(2)} GB`.padStart(10)} ` +
      `${(extraTokens ? kib(growth / extraTokens) : "").padStart(16)}`,
  );
}

// ─── Part 3: a prompt that doesn't fit ───────────────────────────────────────

const FACT = "The access code for the server room is 4719.";
const QUESTION = "What is the access code for the server room? Reply with the code only.";
const LONG = `${FACT}\n\n${filler(2600)}\n\n${QUESTION}`;
const SHORT = "Count from 1 to 30, separated by commas.";

console.log(`\n════ Part 3: a prompt of about 2,700 tokens, the fact in its first line ════\n`);
console.log(`${"context".padStart(8)} ${"prompt".padStart(7)} ${"tokens read".padStart(12)} ${"answer".padStart(10)} ${"reading".padStart(8)} ${"writing".padStart(11)}`);
for (const context of [2048, 4096]) {
  await server.unloadAll();
  await server.load(model, context);
  for (const [label, content] of [["short", SHORT], ["long", LONG]] as const) {
    // num_ctx goes with every request: a request that asks for a different context makes
    // Ollama reload the model.
    try {
      const r = await server.chat(model, [{ role: "user", content }], { num_ctx: context, num_predict: label === "short" ? 60 : 10 });
      const answer = label === "long" ? JSON.stringify(r.text.trim().slice(0, 8)) : "";
      console.log(
        `${String(context).padStart(8)} ${label.padStart(7)} ${String(r.tokensIn).padStart(12)} ${answer.padStart(10)} ` +
          `${`${r.prefillSeconds.toFixed(1)} s`.padStart(8)} ${`${(r.tokensOut / r.decodeSeconds).toFixed(1)} tok/s`.padStart(11)}`,
      );
    } catch (error) {
      console.log(`${String(context).padStart(8)} ${label.padStart(7)}  ${(error as Error).message.slice(0, 120)}`);
    }
  }
}
await server.unloadAll();
console.log(`\nThe right answer is 4719.`);
