// Lesson 1.2: a terminal chatbot with memory.
//
// The model is stateless: it remembers nothing between calls. The bot's "memory"
// is this program resending the whole conversation on every turn.
//
// Run:  npx tsx m01-basics/chat.ts               normal
//       npx tsx m01-basics/chat.ts --no-memory   send only your latest message

import * as readline from "node:readline/promises";
import type OpenAI from "openai";
import { config, llm } from "../common/llm";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const SYSTEM_PROMPT = "You are a friendly, concise assistant. Keep answers short.";
const noMemory = process.argv.includes("--no-memory");

// The conversation so far. This array IS the bot's memory.
const history: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

// Rough rule of thumb for English text: 1 token ≈ 4 characters.
const estimateTokens = (messages: Message[]) => Math.round(JSON.stringify(messages).length / 4);
const grey = (text: string) => `\x1b[90m${text}\x1b[0m`;

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
// Ctrl+C or Ctrl+D closes the terminal: quit quietly instead of printing an error.
terminal.on("close", () => process.exit(0));

console.log(`Chatting with ${config.model}${noMemory ? " (memory OFF)" : ""}`);
console.log(grey("Commands: /history prints the stored conversation · /reset clears it · /exit quits\n"));

while (true) {
  const input = (await terminal.question("you › ")).trim();

  if (input === "") continue;
  if (input === "/exit") break;
  if (input === "/reset") {
    history.splice(1); // keep only the system prompt
    console.log(grey("(memory cleared)\n"));
    continue;
  }
  if (input === "/history") {
    console.log(grey(JSON.stringify(history, null, 2)) + "\n");
    continue;
  }

  history.push({ role: "user", content: input });

  // Normally we send the whole history. With --no-memory we send only the
  // system prompt and your latest message.
  // EXERCISE 1: send the system prompt plus only the last N messages instead.
  const messages = noMemory ? [history[0], history[history.length - 1]] : history;

  const stream = await llm.chat.completions.create({
    model: config.model,
    messages,
    stream: true, // receive the answer piece by piece, as it is generated
    stream_options: { include_usage: true }, // ask for token counts in the last piece
  });

  process.stdout.write("bot › ");
  let answer = "";
  let tokensOut = 0;
  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content ?? "";
    process.stdout.write(piece);
    answer += piece;
    if (chunk.usage) tokensOut = chunk.usage.completion_tokens;
  }
  history.push({ role: "assistant", content: answer });

  // Watch the first numbers: they grow every turn, because everything is resent.
  console.log(
    grey(`\n[sent ${messages.length} messages (~${estimateTokens(messages)} tokens) · received ${tokensOut} tokens]\n`),
  );
}

terminal.close();
