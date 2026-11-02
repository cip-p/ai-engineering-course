// Shared setup for every lesson: which model we use and how we reach it.
// To switch model or provider, change it here or in .env, never inside a lesson.

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import OpenAI from "openai";

// Load settings from .env if the file exists (built into Node since v20.12).
try {
  process.loadEnvFile();
} catch {
  // No .env file: the defaults below apply.
}

export const config = {
  // The chat model. It must be one you've downloaded with `ollama pull`.
  model: process.env.MODEL ?? "qwen3:4b-instruct-2507-q4_K_M",

  // The embedding model (Module 4 on): it turns text into vectors instead of generating text.
  embedModel: process.env.EMBED_MODEL ?? "nomic-embed-text",

  // Ollama's own ("native") API. Only the raw HTTP demo in lesson 1.1 uses it.
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",

  // Ollama also speaks the OpenAI-compatible API under /v1. Point these two at
  // another provider (Hugging Face, Groq, ...) and every lesson keeps working.
  baseURL: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: process.env.LLM_API_KEY ?? "ollama", // Ollama ignores the key, but the SDK requires one
};

// The client every lesson uses to talk to the model.
export const llm = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });

// ─── From Module 3 on ────────────────────────────────────────────────────────

type Message = OpenAI.Chat.ChatCompletionMessageParam;
export const system = (content: string): Message => ({ role: "system", content });
export const user = (content: string): Message => ({ role: "user", content });
export const assistant = (content: string): Message => ({ role: "assistant", content });

// Where a request goes: a client (which provider) plus a model name.
export type Target = { llm: OpenAI; model: string };
export const local: Target = { llm, model: config.model };

// Where a request goes, spelled out: the server's URL, the key and the model's name.
// Module 9's AI SDK builds its own client from these, instead of using the `openai` one.
export type Endpoint = { baseURL: string; apiKey: string; model: string };

// A second provider, side by side with the local one. Put its settings in .env.<name>
// (gitignored), e.g. .env.hf containing LLM_BASE_URL, LLM_API_KEY and MODEL.
function profileEndpoint(name: string): Endpoint {
  const vars = parseEnv(readFileSync(`.env.${name}`, "utf8")) as Record<string, string | undefined>;
  if (!vars.LLM_BASE_URL || !vars.LLM_API_KEY || !vars.MODEL) {
    throw new Error(`.env.${name} needs LLM_BASE_URL, LLM_API_KEY and MODEL`);
  }
  return { baseURL: vars.LLM_BASE_URL, apiKey: vars.LLM_API_KEY, model: vars.MODEL };
}

export function profile(name: string): Target {
  const { baseURL, apiKey, model } = profileEndpoint(name);
  return { llm: new OpenAI({ baseURL, apiKey }), model };
}

// For scripts with --model (another Ollama model) and --profile (another provider) flags.
export function pickTarget(options: { model?: string; profile?: string }): Target {
  if (options.profile) return profile(options.profile);
  return { llm, model: options.model ?? config.model };
}

// The same choice as pickTarget, as an Endpoint (Module 9 on).
export function pickEndpoint(options: { model?: string; profile?: string }): Endpoint {
  if (options.profile) return profileEndpoint(options.profile);
  return { baseURL: config.baseURL, apiKey: config.apiKey, model: options.model ?? config.model };
}

// Turn texts into embedding vectors, one vector per text (Module 4 on).
export async function embed(texts: string[]): Promise<number[][]> {
  const response = await llm.embeddings.create({
    model: config.embedModel,
    input: texts,
    encoding_format: "float", // the SDK would otherwise ask for base64, which not every server supports
  });
  return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

// One non-streaming request. Returns the answer, any thinking the model did (thinking
// models return it in a separate, non-standard field), and the token counts.
export async function ask(
  messages: Message[],
  options: { target?: Target; temperature?: number; maxTokens?: number; schema?: object } = {},
) {
  const { llm: client, model } = options.target ?? local;
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0, // 0 by default: evals need repeatable answers
    // With a schema, a cap: if the constraint fails to take hold (below), Ollama would
    // otherwise keep generating indefinitely.
    max_tokens: options.maxTokens ?? (options.schema ? 500 : undefined),
    // Constrained decoding: the server only lets the model produce JSON that fits the schema.
    response_format: options.schema
      ? { type: "json_schema", json_schema: { name: "output", schema: options.schema as Record<string, unknown>, strict: true } }
      : undefined,
  });

  const message = completion.choices[0]?.message as any;
  const text = (message?.content ?? "").trim() as string;
  const reasoning = (message?.reasoning ?? message?.reasoning_content ?? "") as string;

  // For models it lists as able to think (the course's Qwen3 included), Ollama leaves room
  // for thinking before it applies the schema. If the model opens with a sentence instead of
  // JSON, that sentence comes back as "reasoning" and the content is empty. The fix is to ask
  // for JSON in the prompt too, as Ollama's documentation recommends.
  if (options.schema && !text) {
    const prose = reasoning ? ` The model wrote prose instead: "${reasoning.slice(0, 80).trim()}…"` : "";
    throw new Error(`No JSON came back.${prose} Ask for JSON in the prompt as well as passing the schema.`);
  }

  return {
    text,
    reasoning,
    tokensIn: completion.usage?.prompt_tokens ?? 0, // Module 8 on
    tokensOut: completion.usage?.completion_tokens ?? 0,
  };
}
