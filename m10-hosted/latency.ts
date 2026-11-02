// Lesson 10.9: latency, local against hosted.
//
// The same streamed request, --runs times per model: how long until the first word you can
// show (TTFT), how fast the rest arrives, and how long the whole answer takes. A hosted
// model adds the network and a queue you don't control, so it's measured several times,
// and the median and the worst run both count.
//
// Run:  npx tsx m10-hosted/latency.ts --profile hf --models Qwen/Qwen3-4B-Instruct-2507:nscale,openai/gpt-oss-120b:groq
//       --runs 5 (the default), --no-local to skip your own model

import { parseArgs } from "node:util";
import { targets, type Named } from "./hosted";

const { values } = parseArgs({
  options: {
    profile: { type: "string" },
    models: { type: "string" },
    runs: { type: "string", default: "5" },
    "no-local": { type: "boolean", default: false },
  },
});
const list = targets({ ...values, local: !values["no-local"] });

const PROMPT = "Explain how a bicycle works in about 150 words.";
// Ollama keeps the cache of the last prompt, and only reads the part of a new prompt that
// differs from it: the same prompt five times would barely be read at all. A different
// number at the start makes every request read its whole prompt, as a new question would.
const question = (n: number) => `Question ${n}: ${PROMPT}`;

type Run = { firstToken: number; ttft: number; total: number; tokens: number; reasoningTokens: number };

async function timed(target: Named, n: number): Promise<Run> {
  const start = performance.now();
  let firstToken = 0; // the first token of any kind, thinking included
  let ttft = 0; // the first token of the answer, which is what a user sees
  let tokens = 0;
  let reasoningTokens = 0;
  const stream = await target.llm.chat.completions.create({
    model: target.model,
    messages: [{ role: "user", content: question(n) }],
    temperature: 0,
    max_tokens: 1000, // room for a reasoning model to think first
    stream: true,
    stream_options: { include_usage: true },
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as { content?: string; reasoning?: string; reasoning_content?: string } | undefined;
    const now = performance.now() - start;
    if ((delta?.reasoning || delta?.reasoning_content) && !firstToken) firstToken = now;
    if (delta?.content) {
      if (!firstToken) firstToken = now;
      if (!ttft) ttft = now;
    }
    if (chunk.usage) {
      tokens = chunk.usage.completion_tokens;
      reasoningTokens = (chunk.usage as any).completion_tokens_details?.reasoning_tokens ?? 0;
    }
  }
  return { firstToken: firstToken / 1000, ttft: ttft / 1000, total: (performance.now() - start) / 1000, tokens, reasoningTokens };
}

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const worst = (xs: number[]) => Math.max(...xs);
const s = (x: number) => `${x.toFixed(2)} s`;

console.log(`"${PROMPT}" · ${values.runs} runs per model\n`);
const rows: { target: Named; runs: Run[] }[] = [];
for (const target of list) {
  process.stdout.write(`${target.label.padEnd(48)} `);
  const runs: Run[] = [];
  // A first request that isn't counted: it loads the local model, and opens the connection.
  await timed(target, 0).catch(() => undefined);
  for (let i = 1; i <= Number(values.runs); i++) {
    try {
      runs.push(await timed(target, i));
      process.stdout.write("·");
    } catch (error) {
      process.stdout.write(`✗ ${(error as Error).message.slice(0, 80)} `);
    }
  }
  console.log();
  rows.push({ target, runs });
}

console.log(`\n${"model".padEnd(48)} ${"TTFT median".padStart(12)} ${"worst".padStart(8)} ${"total median".padStart(13)} ${"worst".padStart(8)} ${"tokens out".padStart(11)} ${"tok/s".padStart(7)}`);
for (const { target, runs } of rows) {
  if (runs.length === 0) continue;
  // Tokens per second once the answer flows: everything after the first token.
  const speed = median(runs.map((r) => r.tokens / Math.max(0.001, r.total - r.firstToken)));
  const reasoning = median(runs.map((r) => r.reasoningTokens));
  console.log(
    `${target.label.padEnd(48)} ${s(median(runs.map((r) => r.ttft))).padStart(12)} ${s(worst(runs.map((r) => r.ttft))).padStart(8)} ` +
      `${s(median(runs.map((r) => r.total))).padStart(13)} ${s(worst(runs.map((r) => r.total))).padStart(8)} ` +
      `${median(runs.map((r) => r.tokens)).toFixed(0).padStart(11)} ${speed.toFixed(0).padStart(7)}` +
      (reasoning ? `  (${reasoning.toFixed(0)} of the tokens were reasoning, before the first word)` : ""),
  );
}
