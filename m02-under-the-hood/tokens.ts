// Lesson 2.1: see text the way the model sees it.
//
// Run:  npx tsx m02-under-the-hood/tokens.ts
//       npx tsx m02-under-the-hood/tokens.ts "any text you like"

import { loadTokenizer } from "./model";

const SAMPLES = [
  "The cat sat on the mat.",
  "Unbelievably, the antidisestablishmentarianism debate continues.",
  "const total = items.reduce((sum, item) => sum + item.price, 0);",
  "Je voudrais un café au lait, s'il vous plaît.",
  "In 2026, 12345 × 678 = 8369910.",
  "Coffee ☕ makes me happy 😄",
  "<|im_start|>user\nHello!<|im_end|>",
];

const tokenizer = await loadTokenizer();
const texts = process.argv.length > 2 ? process.argv.slice(2) : SAMPLES;

for (const text of texts) {
  const ids = tokenizer.encode(text, { add_special_tokens: false });

  // Decode each token on its own to see the piece of text it stands for. A "�"
  // means the token holds only part of a character: emoji and accented letters are
  // several bytes long, and a token can split them.
  const pieces = ids.map((id) => JSON.stringify(tokenizer.decode([id], { clean_up_tokenization_spaces: false })).slice(1, -1));

  console.log(JSON.stringify(text));
  console.log(`  ${ids.length} tokens for ${text.length} characters (${(text.length / ids.length).toFixed(1)} characters per token)`);
  console.log(`  │${pieces.join("│")}│`);
  console.log(`  ids: ${ids.join(", ")}\n`);
}
