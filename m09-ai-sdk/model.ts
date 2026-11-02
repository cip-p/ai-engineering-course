// Module 9 (framework): your model, as the AI SDK sees it. Same server, key and model as every
// other lesson: they come from common/llm.ts (or --profile), so switching stays a one-place change.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Endpoint } from "../common/llm";

// --show-request: print the exact JSON the SDK sends, to compare it with what Module 6 sent.
const showingFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body === "string") {
    let body: string = init.body;
    try {
      body = JSON.stringify(JSON.parse(init.body), null, 2);
    } catch {
      // Not JSON: print it as it is.
    }
    console.log(`\n──── REQUEST ────\n${body}`);
  }
  return fetch(input, init);
};

export function sdkModel(endpoint: Endpoint, { showRequests = false } = {}) {
  const provider = createOpenAICompatible({
    name: "ollama",
    baseURL: endpoint.baseURL,
    apiKey: endpoint.apiKey,
    includeUsage: true, // token counts for streamed answers too
    supportsStructuredOutputs: true, // Ollama accepts a JSON Schema for the output (Module 3)
    fetch: showRequests ? showingFetch : undefined,
  });
  return provider(endpoint.model);
}
