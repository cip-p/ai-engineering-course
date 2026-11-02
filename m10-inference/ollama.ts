// Ollama's own ("native") API, for what the OpenAI-compatible one doesn't tell you: how
// long each phase of a request took, how much memory a loaded model uses, and the
// model's shape. Lesson 1.1 (chat-raw.ts) used the same API by hand.

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { config, type Target } from "../common/llm";

export type Message = { role: "system" | "user" | "assistant"; content: string };

// One request, timed by the server. Durations come back in nanoseconds.
export type Timed = {
  text: string;
  tokensIn: number; // the prompt, chat-template markers included
  cachedIn: number; // prompt tokens reused from the previous request (prompt cache)
  tokensOut: number;
  loadSeconds: number;
  prefillSeconds: number; // reading the prompt
  decodeSeconds: number; // writing the answer
  totalSeconds: number;
};

export type Loaded = { name: string; size: number; context_length: number; size_vram: number };

export type Options = { num_ctx?: number; num_predict?: number; temperature?: number };

const seconds = (nanoseconds = 0) => nanoseconds / 1e9;
export const gb = (bytes: number) => bytes / 1e9;

export function ollama(url = config.ollamaUrl) {
  async function post(path: string, body: object): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (error) {
      // Node's fetch waits at most 5 minutes for the server to start answering.
      if ((error as { cause?: { code?: string } }).cause?.code === "UND_ERR_HEADERS_TIMEOUT") {
        throw new Error(`Ollama took more than 5 minutes to start answering, so the request was abandoned`);
      }
      throw new Error(`Could not reach Ollama at ${url}. Is it running?`);
    }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }

  return {
    url,

    // The same model through the OpenAI-compatible API, for ask() and the eval harness.
    target: (model: string): Target => ({ llm: new OpenAI({ baseURL: `${url}/v1`, apiKey: "ollama" }), model }),

    async chat(model: string, messages: Message[], options: Options = {}): Promise<Timed> {
      const data = await post("/api/chat", { model, messages, stream: false, options: { temperature: 0, seed: 1, ...options } });
      return {
        text: data.message?.content ?? "",
        tokensIn: data.prompt_eval_count ?? 0,
        cachedIn: data.prompt_eval_cached_count ?? 0,
        tokensOut: data.eval_count ?? 0,
        loadSeconds: seconds(data.load_duration),
        prefillSeconds: seconds(data.prompt_eval_duration),
        decodeSeconds: seconds(data.eval_duration),
        totalSeconds: seconds(data.total_duration),
      };
    },

    // A request with no prompt only loads the model, here with a context of numCtx tokens.
    load: (model: string, numCtx?: number) => post("/api/generate", { model, keep_alive: "10m", options: numCtx ? { num_ctx: numCtx } : {} }),

    // keep_alive 0 unloads it, freeing its memory.
    unload: (model: string) => post("/api/generate", { model, keep_alive: 0 }),

    async loaded(): Promise<Loaded[]> {
      const response = await fetch(`${url}/api/ps`);
      return ((await response.json()) as { models: Loaded[] }).models;
    },

    // Unload everything, so the next measurement starts cold and has the memory to itself.
    async unloadAll() {
      for (const model of await this.loaded()) await this.unload(model.name);
    },

    // The model's shape (layers, attention heads, …) and its parameter count.
    async show(model: string): Promise<{ info: Record<string, any>; quantization: string }> {
      const data = await post("/api/show", { model });
      return { info: data.model_info, quantization: data.details?.quantization_level ?? "?" };
    },

    // The model's size on disk, in bytes.
    async fileSize(model: string): Promise<number> {
      const response = await fetch(`${url}/api/tags`);
      const { models } = (await response.json()) as { models: { name: string; size: number }[] };
      const found = models.find((m) => m.name === model || m.name === `${model}:latest`);
      if (!found) throw new Error(`model "${model}" not found. Pull it first: ollama pull ${model}`);
      return found.size;
    },
  };
}

export type Ollama = ReturnType<typeof ollama>;

// The course model in its three builds: 4-bit (the default), 8-bit and 16-bit (unquantized).
export const BUILDS = ["qwen3:4b-instruct-2507-q4_K_M", "qwen3:4b-instruct-2507-q8_0", "qwen3:4b-instruct-2507-fp16"];

// "qwen3:4b-instruct-2507-q8_0" → "q8_0": short names for tables.
export const shortName = (model: string) => (model.startsWith("qwen3:4b-instruct-2507-") ? model.split("-").at(-1)! : model);

// Some real prose to fill a prompt with: the course plan, cut to about `tokens` tokens
// (an English token is about 4 characters).
export function filler(tokens: number, from = 0): string {
  const text = readFileSync(new URL("../COURSE.md", import.meta.url), "utf8");
  return text.slice(from, from + tokens * 4);
}
