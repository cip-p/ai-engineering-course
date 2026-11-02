// Lesson 5.2: RAG from scratch. Retrieve, augment, generate.
//
// Run:  npx tsx m05-rag/rag.ts "a question about your course notes"
// Options:  --k 3             how many chunks go into the prompt
//           --chunk-size 800  chunk size in characters (0 = whole sections)
//           --show-prompt     print the whole prompt the model receives
//           --model / --profile   another Ollama model, or a hosted one (Module 3)

import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { ragMessages } from "./prompt";
import { createRetriever } from "./retrieve";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: "3" },
    "chunk-size": { type: "string", default: "800" },
    "show-prompt": { type: "boolean", default: false },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const question = positionals[0];
if (!question) {
  console.error('Usage: npx tsx m05-rag/rag.ts "your question"');
  process.exit(1);
}
const target = pickTarget(values);
const retriever = await createRetriever({ chunkSize: Number(values["chunk-size"]) });

// 1. Retrieve: find the chunks most likely to contain the answer.
let start = performance.now();
const { hits, bestSimilarity } = await retriever.search(question, Number(values.k));
const retrievalSeconds = (performance.now() - start) / 1000;

// 2. Augment: put them into the prompt, numbered.
const messages = ragMessages(question, hits);
if (values["show-prompt"]) {
  console.log("\n──── PROMPT ────");
  for (const message of messages) console.log(`[${message.role}]\n${message.content}\n`);
}

// 3. Generate: the model answers from the sources, citing them.
console.log(`\nQ: ${question}\n`);
process.stdout.write("A: ");
start = performance.now();
let firstTokenAt = 0;
let tokensIn = 0;
let tokensOut = 0;

const stream = await target.llm.chat.completions.create({
  model: target.model,
  messages,
  temperature: 0,
  stream: true,
  stream_options: { include_usage: true },
});
for await (const chunk of stream) {
  const piece = chunk.choices[0]?.delta?.content;
  if (piece) {
    if (!firstTokenAt) firstTokenAt = performance.now();
    process.stdout.write(piece);
  }
  if (chunk.usage) {
    tokensIn = chunk.usage.prompt_tokens;
    tokensOut = chunk.usage.completion_tokens;
  }
}
const end = performance.now();

console.log("\n\nSources:");
hits.forEach((hit, i) => console.log(`  [${i + 1}] ${hit.chunk.id}`));
console.log(
  `\nretrieval ${retrievalSeconds.toFixed(1)} s (best similarity ${bestSimilarity.toFixed(2)}) · ` +
    `prompt ${tokensIn} tokens · first word after ${((firstTokenAt - start) / 1000).toFixed(1)} s · ` +
    `${tokensOut} tokens in ${((end - firstTokenAt) / 1000).toFixed(1)} s`,
);
