// Lesson 1.1: talk to the model with nothing but HTTP.
//
// No SDK and no library: we POST some JSON to Ollama and print what comes back.
//
// Run:  npx tsx m01-basics/chat-raw.ts "Why is the sky blue?"

import { config } from "../common/llm";

const question = process.argv[2] ?? "Explain what a token is in two sentences.";

// This is the entire request. A chat is just a list of messages, each with a role.
const body = {
  model: config.model,
  messages: [
    { role: "system", content: "You are a concise teacher. Answer in at most 3 sentences." },
    { role: "user", content: question },
  ],
  stream: false, // wait for the whole answer instead of receiving it piece by piece
  options: { temperature: 0.7 },
};

// The fields Ollama sends back that we care about. Durations are in nanoseconds.
type OllamaChatResponse = {
  message: { role: string; content: string; thinking?: string };
  prompt_eval_count?: number; // tokens the model read (the input)
  prompt_eval_cached_count?: number; // input tokens reused from an earlier request (prompt cache)
  eval_count: number; // tokens the model wrote (the output)
  load_duration?: number; // time spent loading the model into memory
  prompt_eval_duration?: number; // time spent reading the input
  eval_duration: number; // time spent generating the output
};

console.log("──── REQUEST (what we send) ────");
console.log(JSON.stringify(body, null, 2));

let response: Response;
try {
  response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
} catch {
  console.error(`\nCould not reach Ollama at ${config.ollamaUrl}. Is the Ollama app running?`);
  process.exit(1);
}

if (!response.ok) {
  console.error(`\nOllama returned HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const data = (await response.json()) as OllamaChatResponse;

console.log("\n──── RESPONSE (what comes back) ────");
console.log(JSON.stringify(data, null, 2));

const seconds = (nanoseconds = 0) => nanoseconds / 1e9;

console.log("\n──── WHAT IT MEANS ────");
if (data.message.thinking) console.log(`Thinking:          ${data.message.thinking}`);
console.log(`Answer:            ${data.message.content}`);
console.log(`Input tokens:      ${data.prompt_eval_count ?? 0}  (system prompt + question + chat-template markers)`);
console.log(`Reused from cache: ${data.prompt_eval_cached_count ?? 0}  (input already read on an earlier request)`);
console.log(`Output tokens:     ${data.eval_count}`);
console.log(`Loading the model: ${seconds(data.load_duration).toFixed(2)} s  (big on a cold start, ~0 once loaded)`);
console.log(`Reading the input: ${seconds(data.prompt_eval_duration).toFixed(2)} s`);
console.log(
  `Generating:        ${seconds(data.eval_duration).toFixed(2)} s  → ` +
    `${(data.eval_count / seconds(data.eval_duration)).toFixed(1)} tokens/s`,
);
