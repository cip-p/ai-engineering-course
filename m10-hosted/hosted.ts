// Shared setup for the hosted elective: which models to compare, and what they cost.
//
// A profile (.env.<name>, as in Module 3) gives the provider's URL and key. --models
// picks any number of that provider's models, so one key covers them all. On the
// Hugging Face router, "model:provider" picks who serves it ("openai/gpt-oss-120b:groq");
// ":cheapest" and ":fastest" let the router choose.

import { existsSync, readFileSync } from "node:fs";
import OpenAI from "openai";
import { local, profile, type Target } from "../common/llm";

export type Named = Target & { label: string; hosted: boolean };

export function targets(options: { profile?: string; models?: string; local?: boolean }): Named[] {
  const list: Named[] = [];
  if (options.local !== false) list.push({ ...local, label: `local ${local.model}`, hosted: false });
  if (options.profile) {
    const provider = profile(options.profile);
    for (const model of options.models?.split(",") ?? [provider.model]) list.push({ llm: provider.llm, model, label: model, hosted: true });
  }
  return list;
}

// Price in dollars per million tokens, input and output.
export type Price = { input: number; output: number };

// The Hugging Face router publishes every provider's live prices at /v1/models. Other
// providers don't: put theirs in prices.json, from their pricing page. A price is only
// known when the provider is: ":cheapest" can route to a different one next time.
let catalogue: Promise<any[]> | undefined;
export async function priceOf(target: Named): Promise<Price | undefined> {
  if (!target.hosted) return { input: 0, output: 0 };
  const [id, provider] = target.model.split(":");
  catalogue ??= fetch(`${(target.llm as OpenAI).baseURL}/models`)
    .then(async (response) => ((await response.json()) as { data?: any[] }).data ?? [])
    .catch(() => []);
  const entry = (await catalogue).find((m) => m.id === id);
  const listed = entry?.providers?.find((p: any) => p.provider === provider)?.pricing;
  if (listed) return listed;
  const file = new URL("./prices.json", import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Price>)[target.model] : undefined;
}

export const dollars = (amount: number) => (amount >= 0.01 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(5)}`);
