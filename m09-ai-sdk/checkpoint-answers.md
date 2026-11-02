# Module 9 (framework) checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the runs in [Reference results](README.md#reference-results-qwen34b-instruct-2507-q4_k_m-ai-sdk-7). This file isn't part of the search corpus (only `README.md` is), so it can quote the cases.

## 1. For each piece of your hand-written agent, name the AI SDK piece that replaces it. Which of your pieces has no SDK counterpart, and the other way round?

| Yours | The AI SDK's |
|---|---|
| `runAgent`'s loop and step limit | `ToolLoopAgent`, `stopWhen: isStepCount(8)` |
| A `Tool`: a definition plus a `run` function | `tool({ description, inputSchema, execute })`, with `jsonSchema()` for Module 6's definitions |
| `runTool`'s checks and "Error: …" results | the SDK's checks against the schema, and tool errors sent back to the model |
| The trace printer's events | `onStepEnd`, `onToolExecutionEnd` (and `onLanguageModelCallEnd`) |
| `connect()` in `mcp-tools.ts` | `createMCPClient` + `StdioMCPTransport`, then `client.tools()` |
| `ask()` with a schema; the router | `generateText` with `Output.object` or `Output.choice` |
| `common/llm.ts`'s provider switch | a provider: `createOpenAICompatible`, fed by `pickEndpoint` |

**Yours, with no SDK counterpart:**
- **The text-protocol agent** (lesson 6.1): `Action:` lines and a stop sequence;
- **The decisions you moved into code** (Module 8): the `FEATURES` table, search first, read first, HyDE;
- **Your app's guardrails:** `cleanAnswer`, the queue, the logs and `report.ts`;
- **The eval itself.**

**The SDK's, with no counterpart in yours:**
- **Pinning tool definitions** (`fingerprintTools`, `detectToolDrift`);
- **Approval policies,** including ones driven by MCP annotations;
- **Streaming with tool calls;**
- **Retries;**
- **Telemetry and DevTools;**
- **Dozens of providers;**
- **UI hooks for a web page.**

## 2. Did the framework change the eval's score? Why, or why not?

**No.** Both loops scored 3/6, failing the same tasks: t02 and t06 never called a tool, and t03 drew the wrong conclusion from a correct file. No answer differed between the two loops.

The SDK sent the same request as your loop (question 3). At temperature 0, the same prompt gives the same decisions. A framework changes *how* the request is built, not *what the model decides*. The scores could only differ if the request did, and lesson 9.6 shows exactly that: `Output.choice` changed one word of the request, and one decision with it.

## 3. What does the SDK send to Ollama? What's the same as Module 6's request, and what's different?

**The same:**
- `model` and `temperature: 0`;
- `messages`: system, then user. After a tool call, the assistant message holds the `tool_calls` with Ollama's ids, then a `tool` message with the result;
- `tools`: identical JSON, with every name, description and schema in the same order;
- the token counts: 532 and 583 on t01, 535 and 1,234 on t05.

**Different:**
- **`"tool_choice": "auto"`.** The SDK sends it explicitly. It's the API's default, so it changed nothing.
- **For `Output.choice`:** a `response_format` with the SDK's own schema, `{ "result": { "enum": [...] } }`, where yours was `{ "route": … }`.

The SDK also resends the whole conversation and all the tool definitions on every step, as your loop does, because the API is stateless (Module 1).

## 4. Name two things the SDK gave you that you'd have had to build, and one you'd now trust it with in production.

**Two it gave you:**
- **The MCP client.** The handshake, the tool conversion and closing the server, with no `mcp-tools.ts`.
- **Pinning tool definitions.** It caught your poisoned `search_notes` description before the model saw it. That's the rug-pull defense Module 7 left as an open problem.

Others: checked structured output, streaming with tool calls, approvals, retries, and switching providers.

**One to trust it with in production:** the provider and MCP plumbing, meaning HTTP, retries, provider differences and the MCP handshake. That code is generic, well tested by many users, and boring to own.

Keep the decisions yourself: the prompts, the schemas' wording, when to search. Lesson 9.6 showed why: a default schema the SDK chose cost a case.

## 5. What does depending on a framework cost? Use what you saw in this elective.

- **Prompts you didn't write.** `Output.choice`'s key `result` flipped f51f89e, and you found it only by reading the SDK's source.
- **Defaults that aren't yours:**
  - 20 steps unless you set a limit;
  - no temperature of 0;
  - an invalid answer from a structured output throws, where your router fell back to `notes`.
- **Churn.** Version 7 renamed `onStepFinish`, `system` and `stepCountIs`. Code from memory, yours or a model's, breaks; the docs bundled with the installed version are what you can rely on.
- **Adapter code.** Keeping your own trace and result formats ate most of the savings: 83 lines against 74.
- **Weight and opacity.** Three packages and their dependencies, a ~7% slowdown per task that you can't explain from the outside, and debugging that sometimes means reading someone else's source.

## 6. When would you keep the hand-written loop?

**Keep your own loop when:**
- **You need exact control of the prompt and format:** a small model that reacts to single words, a text protocol, or a server that isn't quite OpenAI-compatible;
- **The loop is small and stable,** and zero dependencies is worth more than features;
- **You're learning or teaching,** where seeing every step is the point;
- **You need behaviour the framework doesn't expose,** or every millisecond and every token is yours to account for.

**Use the framework when you want its features:** streaming UIs, approvals, MCP, many providers, telemetry. Pin its version, and run your eval after every upgrade. The eval is what makes a framework safe to adopt and upgrade: it caught the router difference here, on the first run.
