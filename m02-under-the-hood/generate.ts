// Lesson 2.4: generate text one token at a time, with your own sampler.
//
// Run:  npx tsx m02-under-the-hood/generate.ts                                  greedy (works now)
//       npx tsx m02-under-the-hood/generate.ts --temperature 0.8 --top-p 0.9    after the TODOs
//
// Options:  --prompt "..."  your own prompt
//           --raw           continue plain text instead of answering as a chat assistant
//           --trace         show every step: the token picked, its probability, the time taken
//           --max 40        stop after this many new tokens
//           --temperature, --top-k, --top-p   sampling settings (default: temperature 0 = greedy)

import { parseArgs } from "node:util";
import { chatPrompt, loadModel, loadTokenizer, nextTokenLogits } from "./model";
import { sample, softmax } from "./sampling";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", default: "Invent a name for a new coffee shop. Reply with the name only." },
    raw: { type: "boolean", default: false },
    trace: { type: "boolean", default: false },
    max: { type: "string", default: "40" },
    temperature: { type: "string", default: "0" },
    "top-k": { type: "string" },
    "top-p": { type: "string" },
  },
});

const options = {
  temperature: Number(values.temperature),
  topK: values["top-k"] ? Number(values["top-k"]) : undefined,
  topP: values["top-p"] ? Number(values["top-p"]) : undefined,
};

const tokenizer = await loadTokenizer();
const model = await loadModel();
const decode = (ids: number[]) => tokenizer.decode(ids, { skip_special_tokens: true, clean_up_tokenization_spaces: false });

// A chat reply ends with <|im_end|>: that token is how the model says "I'm done".
const stopIds = new Set(tokenizer.convert_tokens_to_ids(["<|im_end|>", "<|endoftext|>"]) as number[]);

const prompt = values.raw ? values.prompt : chatPrompt(values.prompt);
const promptIds = tokenizer.encode(prompt, { add_special_tokens: false });
const generated: number[] = [];

console.log(`\nSampling: ${JSON.stringify(options)}\n`);
if (values.raw) process.stdout.write(values.prompt);

const startedAt = performance.now();
let printed = "";

for (let step = 1; step <= Number(values.max); step++) {
  const stepStart = performance.now();
  // No KV cache here: every step feeds the WHOLE sequence through the model again.
  const logits = await nextTokenLogits(model, [...promptIds, ...generated]);
  const id = sample(logits, options);
  const ms = performance.now() - stepStart;

  if (stopIds.has(id)) break;
  generated.push(id);

  if (values.trace) {
    const piece = JSON.stringify(decode([id]));
    const modelProbability = softmax(logits)[id]; // how likely the model itself thought this token was
    console.log(
      `step ${String(step).padStart(2)}  ${piece.padEnd(14)} model's probability ${(modelProbability * 100).toFixed(1).padStart(5)}%   ${ms.toFixed(0)} ms`,
    );
  } else {
    // Decode everything so far and print only the new part. Waiting while the text
    // ends in "�" avoids printing half of a multi-byte character such as an emoji.
    const text = decode(generated);
    if (!text.endsWith("�")) {
      process.stdout.write(text.slice(printed.length));
      printed = text;
    }
  }
}

const seconds = (performance.now() - startedAt) / 1000;
console.log(`\n\n[${generated.length} tokens in ${seconds.toFixed(1)} s → ${(generated.length / seconds).toFixed(1)} tokens/s]`);
