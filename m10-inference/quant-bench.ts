// Lesson 10.5: what quantization does to size, memory and speed.
//
// Each build of the model is loaded on its own (the others are unloaded first) and timed
// three ways: loading it, reading a long prompt (prefill), and writing an answer (decode).
// Speed is measured --runs times (the median counts, and the range shows how much the
// runs disagreed): one run of a benchmark is an anecdote.
//
// A laptop runs at full speed only in short bursts: under sustained load, heat and power
// limits slow it down, and compute-bound prefill most of all. So before every timed request
// the script waits (--pause, in seconds), and every measurement starts from the same rest.
//
// Run:  npx tsx m10-inference/quant-bench.ts                  the three builds, ~20 minutes on a CPU
//       npx tsx m10-inference/quant-bench.ts --models qwen3:4b-instruct-2507-q4_K_M,llama3.2:3b
//       add --url http://localhost:11435 to measure a second Ollama server (lesson 10.8)

import { parseArgs } from "node:util";
import { BUILDS, filler, gb, ollama, shortName } from "./ollama";

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    url: { type: "string" },
    runs: { type: "string", default: "3" },
    pause: { type: "string", default: "20" },
  },
});
const models = values.models?.split(",") ?? BUILDS;
const runs = Number(values.runs);
const server = ollama(values.url);

const DECODE_PROMPT = "Explain how a bicycle works in about 150 words.";
// A different stretch of text on every run, so the prompt cache can't help.
const prefillPrompt = (run: number) => `Summarize the following text in one sentence.\n\n${filler(1000, run * 4000)}`;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const range = (xs: number[]) => `${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}`;

type Row = {
  model: string;
  quantization: string;
  fileBytes: number;
  bitsPerWeight: number;
  memoryBytes: number;
  loadSeconds: number;
  prefill: number[]; // tokens/s, one per run
  decode: number[];
  prefillTokens: number;
};

const rows: Row[] = [];
const rest = () => new Promise((resolve) => setTimeout(resolve, Number(values.pause) * 1000));

for (const model of models) {
  await server.unloadAll();
  process.stdout.write(`${model}: `);
  const fileBytes = await server.fileSize(model);
  const { info, quantization } = await server.show(model);

  // Loading reads the whole file from disk into memory.
  const start = performance.now();
  await server.load(model);
  const loadSeconds = (performance.now() - start) / 1000;
  const memoryBytes = (await server.loaded()).find((m) => m.name === model)?.size ?? 0;
  process.stdout.write(`loaded in ${loadSeconds.toFixed(1)} s`);

  const row: Row = {
    model,
    quantization,
    fileBytes,
    bitsPerWeight: (fileBytes * 8) / (info["general.parameter_count"] as number),
    memoryBytes,
    loadSeconds,
    prefill: [],
    decode: [],
    prefillTokens: 0,
  };
  for (let run = 0; run < runs; run++) {
    // Prefill: a long prompt and a short answer, so nearly all the time is reading.
    // Only the tokens that weren't in the prompt cache count.
    await rest();
    const prefill = await server.chat(model, [{ role: "user", content: prefillPrompt(run) }], { num_predict: 10 });
    row.prefillTokens = prefill.tokensIn - prefill.cachedIn;
    row.prefill.push(row.prefillTokens / prefill.prefillSeconds);

    // Decode: a short prompt and a long answer, so nearly all the time is writing.
    await rest();
    const decode = await server.chat(model, [{ role: "user", content: DECODE_PROMPT }], { num_predict: 120 });
    row.decode.push(decode.tokensOut / decode.decodeSeconds);
    process.stdout.write(" ·");
  }
  console.log(` prefill ${median(row.prefill).toFixed(1)} tok/s · decode ${median(row.decode).toFixed(1)} tok/s`);
  rows.push(row);
}
await server.unloadAll();

const pad = (text: string | number, width: number) => String(text).padStart(width);
console.log(
  `\n${"build".padEnd(10)} ${pad("quant", 7)} ${pad("file", 8)} ${pad("bits/weight", 11)} ${pad("memory", 8)} ${pad("load", 7)} ` +
    `${pad("prefill tok/s", 19)} ${pad("decode tok/s", 17)} ${pad("read/s", 8)}`,
);
for (const r of rows) {
  console.log(
    `${shortName(r.model).padEnd(10)} ${pad(r.quantization, 7)} ${pad(`${gb(r.fileBytes).toFixed(2)} GB`, 8)} ${pad(r.bitsPerWeight.toFixed(1), 11)} ` +
      `${pad(`${gb(r.memoryBytes).toFixed(2)} GB`, 8)} ${pad(`${r.loadSeconds.toFixed(1)} s`, 7)} ` +
      `${pad(`${median(r.prefill).toFixed(1)} (${range(r.prefill)})`, 19)} ${pad(`${median(r.decode).toFixed(1)} (${range(r.decode)})`, 17)} ` +
      // Every decoded token reads all the weights once, so file size × tokens/s is roughly
      // the memory bandwidth decode achieved.
      `${pad(`${gb(r.fileBytes * median(r.decode)).toFixed(0)} GB/s`, 8)}`,
  );
}

// If decode is memory-bound, its speed follows the size: half the bytes, twice the tokens/s.
if (rows.length > 1) {
  const [first] = rows;
  console.log(`\nCompared with ${shortName(first.model)} (medians):`);
  for (const r of rows.slice(1)) {
    console.log(
      `  ${shortName(r.model).padEnd(10)} ${(r.fileBytes / first.fileBytes).toFixed(2)}× the bytes · ` +
        `decode ${(median(r.decode) / median(first.decode)).toFixed(2)}× (size alone predicts ${(first.fileBytes / r.fileBytes).toFixed(2)}×) · ` +
        `prefill ${(median(r.prefill) / median(first.prefill)).toFixed(2)}×`,
    );
  }
}
console.log(`\n${runs} run(s) per build · prefill: ${rows[0]?.prefillTokens} prompt tokens · decode: up to 120 tokens`);
