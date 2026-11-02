// Lesson 10.11: when the provider says no. Retries, timeouts and a fallback model.
//
// Eight Module 3 tickets go through flaky.ts, a proxy that plays a busy provider: it
// answers some requests with 429 (rate limited) or 503 (overloaded), and holds one for
// 12 seconds. They go through it three ways:
//   no retries    the first error is the answer
//   SDK retries   the openai SDK's defaults: 2 retries, with backoff, honouring Retry-After
//   gateway       our own policy: give up on the provider sooner, and fall back to a second model
//
// Run:  npx tsx m10-hosted/gateway.ts                  behind the proxy: your Ollama (free), ~3 minutes
//       npx tsx m10-hosted/gateway.ts --profile hf     behind the proxy: a hosted model, with Ollama as the fallback

import OpenAI from "openai";
import { parseArgs } from "node:util";
import { ask, local, pickEndpoint, system, type Target } from "../common/llm";
import { ANSWER_ONLY, DEFINITIONS, loadTickets, normalize, ticketMessage } from "../m03-prompting-evals/tickets";
import { SCHEDULE, startFlakyProxy } from "./flaky";

const { values } = parseArgs({ options: { profile: { type: "string" }, model: { type: "string" } } });
const upstream = pickEndpoint(values);
const proxy = await startFlakyProxy(upstream);
const tickets = loadTickets().slice(0, 8);

const classify = (target: Target, ticket: string) => ask([system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`), ticketMessage(ticket)], { target, maxTokens: 1000 });

// The provider, as seen through the proxy, with a given retry policy.
const viaProxy = (options: { maxRetries: number; timeout: number }): Target => ({
  llm: new OpenAI({ baseURL: proxy.url, apiKey: "unused", ...options }),
  model: upstream.model,
});

type Answer = { text: string; by: string };

// Our own policy. A user is waiting, so: one quick retry, only when the provider says how
// long to wait and it's short; a 5-second timeout; then the fallback model answers instead.
async function gateway(ticket: string): Promise<Answer> {
  const primary = viaProxy({ maxRetries: 0, timeout: 5_000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { text: (await classify(primary, ticket)).text, by: "provider" };
    } catch (error) {
      const wait = Number((error as { headers?: Headers }).headers?.get?.("retry-after") ?? NaN);
      if (attempt === 2 || !(wait <= 2)) break; // no hint, or too long a wait: don't retry
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
  // The fallback: here your local model, reached directly. In production, often a second
  // provider, or a smaller, cheaper model.
  return { text: (await classify(local, ticket)).text, by: "fallback" };
}

const ways: [string, (ticket: string) => Promise<Answer>][] = [
  ["no retries", async (t) => ({ text: (await classify(viaProxy({ maxRetries: 0, timeout: 10_000 }), t)).text, by: "provider" })],
  ["SDK retries", async (t) => ({ text: (await classify(viaProxy({ maxRetries: 2, timeout: 10_000 }), t)).text, by: "provider" })],
  ["gateway", gateway],
];

console.log(`Behind the proxy: ${upstream.model} at ${upstream.baseURL}`);
console.log(`The proxy's schedule, one entry per request it receives: ${SCHEDULE.join(" → ")} → (again)\n`);

// A warm-up, so the local model is loaded before the clock starts.
await classify(local, "warm-up");

const summary: string[] = [];
for (const [name, run] of ways) {
  proxy.reset();
  console.log(`── ${name} ──`);
  const start = performance.now();
  let answered = 0;
  let right = 0;
  let slowest = 0;
  for (const ticket of tickets) {
    const begin = performance.now();
    let line: string;
    try {
      const answer = await run(ticket.input);
      answered++;
      const correct = normalize(answer.text) === ticket.expected;
      if (correct) right++;
      line = `${correct ? "✓" : "✗"} ${normalize(answer.text).padEnd(10)} by ${answer.by}`;
    } catch (error) {
      line = `✗ error: ${(error as Error).message.split("\n")[0].slice(0, 60)}`;
    }
    const seconds = (performance.now() - begin) / 1000;
    slowest = Math.max(slowest, seconds);
    // What the proxy did with each request it received while this ticket was being answered.
    const seen = proxy.log.splice(0).map((entry) => entry.behaviour);
    console.log(`  ${ticket.id}  ${`${seconds.toFixed(1)} s`.padStart(6)}  ${line.padEnd(48)} proxy: ${seen.join(", ") || "-"}`);
  }
  const total = (performance.now() - start) / 1000;
  summary.push(`${name.padEnd(12)} ${`${answered}/${tickets.length}`.padStart(9)} ${`${right}/${tickets.length}`.padStart(6)} ${`${total.toFixed(1)} s`.padStart(8)} ${`${slowest.toFixed(1)} s`.padStart(9)}`);
  console.log();
}

console.log(`${"way".padEnd(12)} ${"answered".padStart(9)} ${"right".padStart(6)} ${"total".padStart(8)} ${"slowest".padStart(9)}`);
for (const line of summary) console.log(line);
await proxy.close();
