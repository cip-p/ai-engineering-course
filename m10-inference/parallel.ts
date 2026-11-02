// Lesson 10.8: batching, or latency against throughput.
//
// Sends 1, 2, 4 and 8 requests at the same moment and times each one from the moment it
// was sent, so waiting in a queue counts. With one slot (Ollama's default) the requests
// take turns. With several slots the server decodes them together, as one batch: each
// step reads the weights once for all of them.
//
// Batched decode does several times the arithmetic per weight read, so it's the measurement
// most sensitive to a hot laptop: the script rests (--pause, in seconds) before each batch.
//
// Run:  npx tsx m10-inference/parallel.ts                               your server, ~4 minutes on a CPU
//       npx tsx m10-inference/parallel.ts --url http://localhost:11435   a second server with 4 slots (see README)

import { parseArgs } from "node:util";
import { config } from "../common/llm";
import { gb, ollama } from "./ollama";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: config.model },
    url: { type: "string" },
    batches: { type: "string", default: "1,2,4,8" },
    tokens: { type: "string", default: "80" },
    pause: { type: "string", default: "20" },
  },
});
const model = values.model;
const server = ollama(values.url);
const tokens = Number(values.tokens);

// Different topics, so that no request can reuse another's prompt from the cache.
const TOPICS = ["lighthouses", "volcanoes", "honeybees", "glaciers", "submarines", "rainforests", "comets", "windmills"];
const prompt = (topic: string) => `Write about ${topic} in about 150 words.`;

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

await server.unloadAll();
await server.load(model);
const { size, context_length } = (await server.loaded()).find((m) => m.name === model)!;
console.log(`${model} at ${server.url} · ${gb(size).toFixed(2)} GB in memory · context ${context_length} tokens · ${tokens} tokens per answer\n`);

// A warm-up, so the first batch doesn't pay for anything the others don't.
await server.chat(model, [{ role: "user", content: prompt("teapots") }], { num_predict: 5 });

console.log(`${"at once".padStart(7)} ${"latency: first".padStart(15)} ${"median".padStart(7)} ${"last".padStart(7)} ${"each decodes at".padStart(16)} ${"total output".padStart(13)}`);
let single = 0;
for (const n of values.batches.split(",").map(Number)) {
  await new Promise((resolve) => setTimeout(resolve, Number(values.pause) * 1000));
  const start = performance.now();
  const runs = await Promise.all(
    TOPICS.slice(0, n).map(async (topic) => {
      const result = await server.chat(model, [{ role: "user", content: prompt(topic) }], { num_predict: tokens });
      return { ...result, latency: (performance.now() - start) / 1000 };
    }),
  );
  const wall = (performance.now() - start) / 1000;
  const throughput = runs.reduce((sum, r) => sum + r.tokensOut, 0) / wall;
  if (n === 1) single = throughput;
  console.log(
    `${String(n).padStart(7)} ${`${Math.min(...runs.map((r) => r.latency)).toFixed(1)} s`.padStart(15)} ` +
      `${`${median(runs.map((r) => r.latency)).toFixed(1)} s`.padStart(7)} ${`${wall.toFixed(1)} s`.padStart(7)} ` +
      `${`${median(runs.map((r) => r.tokensOut / r.decodeSeconds)).toFixed(1)} tok/s`.padStart(16)} ` +
      `${`${throughput.toFixed(1)} tok/s`.padStart(13)}${single ? `  (${(throughput / single).toFixed(1)}×)` : ""}`,
  );
}
await server.unloadAll();
