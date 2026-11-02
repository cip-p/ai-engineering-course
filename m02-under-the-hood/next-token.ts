// Lesson 2.2: look inside one prediction.
//
// Run:  npx tsx m02-under-the-hood/next-token.ts "The capital of France is the city of"
//       npx tsx m02-under-the-hood/next-token.ts --chat "Invent a name for a new coffee shop. Reply with the name only."
// After TODO 1 in sampling.ts, add --temperature 0.5 (or 1.5) to see the same scores reshaped.

import { parseArgs } from "node:util";
import { chatPrompt, loadModel, loadTokenizer, nextTokenLogits } from "./model";
import { applyTemperature, rankByProbability, softmax } from "./sampling";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    chat: { type: "boolean", default: false },
    temperature: { type: "string", default: "1" },
  },
});

const text = positionals[0] ?? "The capital of France is the city of";
const temperature = Number(values.temperature);
if (!(temperature > 0)) {
  console.error("Use a temperature above 0 here. Temperature 0 means greedy: just take the top token.");
  process.exit(1);
}

const tokenizer = await loadTokenizer();
const model = await loadModel();

const prompt = values.chat ? chatPrompt(text) : text;
const ids = tokenizer.encode(prompt, { add_special_tokens: false });
const logits = await nextTokenLogits(model, ids);

// Temperature changes the probabilities, never the model's scores: the logits column stays the same.
const probs = softmax(temperature === 1 ? logits : applyTemperature(logits, temperature));

console.log(`\nPrompt: ${JSON.stringify(prompt)} (${ids.length} tokens)`);
console.log(`The model scored all ${logits.length.toLocaleString()} tokens in its vocabulary.`);
console.log(`Top 10 candidates for the next token${temperature === 1 ? "" : `, at temperature ${temperature}`}:\n`);

let covered = 0;
for (const id of rankByProbability(probs).slice(0, 10)) {
  covered += probs[id];
  const piece = JSON.stringify(tokenizer.decode([id], { clean_up_tokenization_spaces: false }));
  const percent = (probs[id] * 100).toFixed(1).padStart(5);
  const bar = "█".repeat(Math.round(probs[id] * 40));
  console.log(`  ${piece.padEnd(16)} logit ${logits[id].toFixed(2).padStart(6)}   ${percent}%  ${bar}`);
}

const others = (logits.length - 10).toLocaleString();
console.log(`\nThese 10 cover ${(covered * 100).toFixed(1)}% of the probability; the other ${others} tokens share the rest.`);
