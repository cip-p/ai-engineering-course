// Lesson 1.3: sampling and speed.
//
// Part 1 asks the same question several times at different temperatures, so you
// can see how temperature changes the variety of the answers.
// Part 2 measures how fast the model responds.
//
// Run:  npx tsx m01-basics/sampling-lab.ts

import { config, llm } from "../common/llm";

const SAMPLING_PROMPT = "Invent a name for a new coffee shop. Reply with the name only.";
const TEMPERATURES = [0, 0.7, 1.5];
const RUNS = 4;

const SPEED_PROMPT = "Explain how a bicycle works in about 150 words.";

type Result = { text: string; tokens: number; ttft: number; tokensPerSecond: number };

// One streamed call, timed. TTFT ("time to first token") is how long we wait
// before the first piece of the answer arrives.
async function generate(prompt: string, temperature: number, maxTokens: number): Promise<Result> {
  const start = performance.now();
  let firstPieceAt = 0;
  let text = "";
  let pieces = 0;
  let tokensOut = 0;

  const stream = await llm.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    top_p: 1.0, // keep only the most likely candidates that together cover top_p of the probability (1.0 = no filter)
    // Hard stop, in case a high temperature makes it ramble. The SDK marks max_tokens as
    // deprecated because OpenAI's own API renamed it to max_completion_tokens, but Ollama
    // only supports max_tokens.
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  });

  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content;
    if (piece) {
      if (pieces === 0) firstPieceAt = performance.now();
      text += piece;
      pieces++;
    }
    if (chunk.usage) tokensOut = chunk.usage.completion_tokens;
  }

  const generatingSeconds = (performance.now() - firstPieceAt) / 1000;
  const tokens = tokensOut || pieces;
  return {
    text: text.trim(),
    tokens,
    ttft: (firstPieceAt - start) / 1000,
    tokensPerSecond: tokens / generatingSeconds,
  };
}

console.log(`Model: ${config.model}\n`);
console.log(`PART 1: sampling. Prompt: "${SAMPLING_PROMPT}"\n`);

for (const temperature of TEMPERATURES) {
  const answers: string[] = [];
  for (let run = 0; run < RUNS; run++) {
    answers.push((await generate(SAMPLING_PROMPT, temperature, 30)).text);
  }
  const distinct = new Set(answers).size;
  console.log(`temperature ${temperature}: ${distinct} distinct answer(s) out of ${RUNS}`);
  answers.forEach((answer, i) => console.log(`  ${i + 1}. ${answer}`));
  console.log();
}

console.log(`PART 2: speed. Prompt: "${SPEED_PROMPT}"\n`);
const { text, tokens, ttft, tokensPerSecond } = await generate(SPEED_PROMPT, 0.7, 300);
console.log(`${text}\n`);
console.log(`answer length:       ${tokens} tokens, ${text.split(/\s+/).length} words`);
console.log(`time to first token: ${ttft.toFixed(2)} s`);
console.log(`generation speed:    ${tokensPerSecond.toFixed(1)} tokens/s`);
