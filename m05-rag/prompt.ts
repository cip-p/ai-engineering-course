// The "augment" step: put the retrieved chunks into the prompt, numbered so the answer
// can cite them. The instructions come first (identical every time, so they stay
// cached), then the sources, and the question last.

import { system, user } from "../common/llm";
import type { Hit } from "../m04-embeddings/corpus";

export const DONT_KNOW = "I don't know based on the notes.";

export const INSTRUCTIONS = `You answer questions about the user's course notes, using only the numbered sources you are given.
- Base every statement on the sources, and cite them like [1] or [2].
- If the sources don't contain the answer, reply exactly: ${DONT_KNOW}
- Keep the answer short: two or three sentences.`;

export function ragMessages(question: string, hits: Hit[]) {
  const sources = hits.map((hit, i) => `[${i + 1}] ${hit.chunk.title}\n${hit.chunk.text}`).join("\n\n");
  return [system(INSTRUCTIONS), user(`<sources>\n${sources}\n</sources>\n\nQuestion: ${question}`)];
}
