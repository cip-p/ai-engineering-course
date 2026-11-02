# Module 9 (elective): Rebuild the agent with a framework

**Goal:** rebuild your Module 6 agent, Module 7's MCP client and Module 8's router with the Vercel AI SDK (version 7). Then judge the framework the course's way: same model, same tasks, same eval, measured side by side with the code you wrote yourself.

## Concepts (read before running anything)

1. **A framework is code you didn't write, doing what you did write.** You built the agent loop, the tool definitions, the argument checks, the MCP client and the router by hand, so nothing in a framework should look like magic now. The question is no longer "how does it work?", but "what does it buy me, and what does it cost?". Answer it with measurements.

2. **What maps to what:**

   | You built | The AI SDK's piece |
   |---|---|
   | `runAgent`: the loop, the step limit (Module 6) | `ToolLoopAgent`, with `stopWhen: isStepCount(8)` |
   | A tool: a JSON Schema definition, plus a function (Module 6) | `tool({ description, inputSchema, execute })`. `jsonSchema()` takes Module 6's definitions unchanged |
   | `runTool`: parse and check the arguments, turn errors into "Error: …" (Module 6) | The SDK checks the arguments against the schema, and sends a tool's errors back to the model |
   | The trace printer (Module 6) | Lifecycle callbacks: `onStepEnd`, `onToolExecutionEnd` |
   | `connect()` in `mcp-tools.ts` (Module 7) | `createMCPClient` from `@ai-sdk/mcp`, then `client.tools()` |
   | `ask()` with a JSON Schema, and the router (Modules 3 and 8) | `generateText` with `output: Output.choice(…)` or `Output.object(…)` |
   | `common/llm.ts`: one place to switch provider (Module 1) | A provider, here `createOpenAICompatible`, pointed at the same Ollama URL |

3. **What it adds that you didn't build.** Streaming with tool calls. Tool approvals, including policies based on a server's annotations. Checked structured output. Retries. Telemetry. Dozens of providers behind one API. UI hooks for a web page. And one that answers a Module 7 problem: **pinning tool definitions**, so that a server that changes a tool's description or schema after you approved it gets caught (lesson 9.5).

4. **What it costs:**
   - **Abstraction.** The prompt and the request are built for you. `--show-request` prints what the SDK actually sends, so you can compare it with Module 6's.
   - **Defaults that aren't yours.** The step limit is 20 unless you set one. The temperature isn't 0. An invalid answer from a structured output throws an error, where your router fell back to `notes`.
   - **Churn.** Version 7 renamed things that version 5 had: `onStepFinish` became `onStepEnd`, `system` became `instructions`, `stepCountIs` became `isStepCount`. Code written from memory, yours or a model's, goes stale. The SDK ships its documentation inside `node_modules/ai/docs/`, matched to the installed version: read that.
   - **Weight:** more dependencies, and more versions to keep current.

5. **The model doesn't change.** A framework can't make a 4B model decide better. With the same prompt and the same tools, expect the same decisions, and the same failures (Module 6's t02 and t06). If the scores differ, look for a difference in what was sent.

## Setup

```bash
npm install ai@7 @ai-sdk/openai-compatible@3 @ai-sdk/mcp@2
npm run typecheck
```

The SDK needs Node.js 22 or later (the course's minimum is 22.13), and only works as ES modules, which this repo already uses.

| File | What it is |
|---|---|
| `model.ts` | Your Ollama model as an AI SDK model, from the same settings as `common/llm.ts`. `--show-request` prints each request |
| `sdk-loop.ts` | Lesson 9.3: Module 6's `agent-loop.ts`, rebuilt with `ToolLoopAgent`. The same result and trace events |
| `sdk-agent.ts` | Lesson 9.3: Module 6's `agent.ts`, on the SDK |
| `sdk-eval.ts` | Lesson 9.4: Module 6's eval, run by both loops |
| `sdk-mcp.ts` | Lesson 9.5: MCP servers through the SDK's MCP client, with pinned tool definitions |
| `sdk-router.ts` | Lesson 9.6: Module 8's router, yours against `Output.choice` |

Changes outside this folder:
- `common/llm.ts` adds `pickEndpoint`, the same choice as `pickTarget`, as a URL, key and model name;
- `m08-slack/assistant.ts` exports the router's prompt and schema.

## Lesson 9.3: The same agent, on the SDK (`sdk-agent.ts`)

```bash
npx tsx m09-ai-sdk/sdk-agent.ts --task t05
npx tsx m06-agents/agent.ts --task t05
```

Then look at what goes over the wire:

```bash
npx tsx m09-ai-sdk/sdk-agent.ts --task t01 --show-request
npx tsx m06-agents/agent.ts --task t01 --show-tools
```

**What to notice**
- **The two traces.** Same steps, same tool calls, same answer? At temperature 0, with the same prompt and the same tools, they should match.
- **The times, and the order you ran them in.** The first run pays one-time costs: loading the model into memory, and embedding any notes that changed. Compare the steps that ran warm in both, or rerun the first one.
- **`tokens in` on step 1.** If the SDK sent exactly what Module 6 sent, the two numbers are equal. If they differ, the request shows why.
- **The request.** It's the same OpenAI-format JSON: `messages`, `tools`, `temperature`. Find what the SDK adds that Module 6 didn't send, and anything it leaves out.
- **`sdk-loop.ts` next to `agent-loop.ts`.** The loop, the step counting and the message history aren't in it any more. What is left is all yours: the adapter for your tools, and the trace.

## Lesson 9.4: Measure it (`sdk-eval.ts`)

```bash
npx tsx m09-ai-sdk/sdk-eval.ts
```

Both loops run Module 6's six scored tasks, one loop after the other. That's a few minutes on a CPU (3.5 on the reference laptop). A warm-up runs first and isn't measured, so the first loop doesn't pay the cold start for both (lesson 9.3).

**What to notice**
- **The score, per loop,** and the line that lists the tasks where the two answers differ. Module 6's native agent scored 3/6.
- **Model calls and time per task.** Does the framework cost anything you can measure?
- **The lines of code** at the end. Count what the SDK saved you, and what it didn't: the adapter, the trace and the eval are still yours to write.

## Lesson 9.5: MCP through the SDK (`sdk-mcp.ts`)

```bash
npx tsx m09-ai-sdk/sdk-mcp.ts --task t05
npx tsx m09-ai-sdk/sdk-mcp.ts --task t05
```

The first run pins the notes server's tool definitions in `.cache/tool-pins.json`. The second run checks them. Now poison the tool, as in Module 7's exercise 4: add a sentence to the end of `search_notes`'s description in `m07-mcp/notes-server.ts`, and run it again. Then remove the sentence.

**What to notice**
- **`sdk-mcp.ts` has no `mcp-tools.ts` in it.** The SDK's client did the handshake and the tool conversion.
- **The poisoned run stops before the model sees anything,** naming the changed tool. In Module 7, the poisoned description went straight into the prompt.
- **What pinning can't catch.** It compares what a server says about its tools, not what they do. A tool that keeps its description and changes its behaviour passes.
- **Try the filesystem server,** with `--server files --task t03 --tools list_allowed_directories,list_directory,read_text_file`. The 14 tools are pinned, but only the three you name reach the model.

## Lesson 9.6: The router, with `Output.choice` (`sdk-router.ts`)

```bash
npx tsx m09-ai-sdk/sdk-router.ts
```

It runs Module 8's router prompt (v2) on every case with a `route`, three ways: your way, the SDK's `Output.choice`, and the SDK's `Output.object` with your own Zod schema.

**What to notice**
- **The scores.** Same prompt, same model: do the three agree on every case? If one disagrees, compare what each makes the model write: the JSON Schema `Output.choice` builds is in the SDK's source (`node_modules/ai/src/generate-text/output.ts`).
- **The time per call.** Is the SDK's version any slower?
- **What happens to an invalid answer.** Yours falls back to `notes`. The SDK's throws an error, which shows up as `error:` in the table. Which do you want in a Slack bot, and which in an eval?

## Exercises

1. **Stream it.** Rewrite `runSdkAgent` with `agent.stream()`, or `streamText`, and print the text as it arrives, along with each tool call. Module 9's web exercise 3 asked for the same thing by hand: what happens to the text of a step that ends in a tool call?
2. **Approvals from annotations.** Give the agent all 14 filesystem tools, with a `toolApproval` policy: tools marked `readOnlyHint: true` run, and every other one asks you y/n in the terminal. The policy is in the SDK's MCP docs. Compare it with Module 6's exercise 1, where you wrote the approval yourself. Why are annotations alone not enough?
3. **Port the notes route.** Rewrite Module 8's notes route, the search and Module 5's prompt, with `generateText`, and run `m08-slack/eval.ts` with it. Same score? Same time?
4. **A bigger model in one line.** Run `sdk-eval.ts --profile hf`, or any `.env.<name>` profile. Which failures disappear with a bigger model, and which stay? (This answers Module 6's exercise 7.)
5. **useChat.** Replace the stream reader in `m09-web/ui/app/page.tsx` with the SDK's UI hook from `@ai-sdk/react`. Read its bundled docs first: this API changes often. What do you gain? Can its message format still carry what your timeline needs: the route, your code's searches, and the time of every step?

## Checkpoint (answer in your own words)

1. For each piece of your hand-written agent, name the AI SDK piece that replaces it. Which of your pieces has no SDK counterpart, and the other way round?
2. Did the framework change the eval's score? Why, or why not?
3. What does the SDK send to Ollama? What's the same as Module 6's request, and what's different?
4. Name two things the SDK gave you that you'd have had to build, and one you'd now trust it with in production.
5. What does depending on a framework cost? Use what you saw in this elective.
6. When would you keep the hand-written loop?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (`qwen3:4b-instruct-2507-q4_K_M`, AI SDK 7)

This README is part of the corpus, so tasks and cases appear here by id only.

| Measurement | Value |
|---|---|
| Lesson 9.3, t05 | **identical traces**: 535 and 1,234 tokens in, the same text, query, passages and answer |
| Lesson 9.3, the times | SDK 52.5 s, run first and cold (it loaded the model and embedded 30 changed sections), against 27.5 s for yours. Warm, step 2 took 19.9 s against 20.1 s |
| Lesson 9.3, t01's request | field for field Module 6's: the same tools JSON, messages and temperature. The only addition was `"tool_choice": "auto"`, the default. 532 and 583 tokens in both |
| Lesson 9.4, Module 6's eval | yours **3/6**, the SDK **3/6**, failing the same tasks. No answer differed. 1.7 model calls and 0 errors each; 10.3 s against 11.0 s per task |
| Lines of code | `agent-loop.ts` 83, `sdk-loop.ts` 74 |
| Lesson 9.5, pins | first run: 1 tool pinned · second run: a match · the poisoned description: stopped before the model, "changed: search_notes" |
| Lesson 9.5, the prompt | 254 tokens on step 1, the same as Module 7's hand-written client |
| Lesson 9.6, the router (6 cases) | yours **6/6** · `Output.choice` **5/6** · `Output.object` with your schema **6/6**; 1.0–2.4 s per call for all three |

**What these runs showed**
- **The framework sends what you sent.** The same request, field for field, so the model saw the same prompt and made the same decisions: identical traces, and the same 3/6 with the same failures. A framework can't fix a model's decisions. In Module 8, design did: search first, a router, HyDE.
- **It saved you the loop, not the work.** 83 lines became 74. The loop and the message history went away, but keeping Module 6's trace and result format took an adapter, an output converter and callbacks. The savings come from using a framework's own features, not from rebuilding yours on top of it.
- **The first run pays.** A cold model and newly embedded notes made the SDK look twice as slow in lesson 9.3. Warm, the same steps matched within 0.2 s, and that's what the eval's warm-up is for. Over the whole eval the SDK was still ~7% slower per task, with identical requests, and this run can't say why.
- **Pinning caught tool poisoning.** The changed description stopped the run before the model saw it, which is the defense Module 7 didn't have. It trusts whatever it pinned first, and it can't see a tool that changes its behaviour but not its description.
- **A framework's defaults are prompts you didn't write.** `Output.choice` makes the model write its answer under the key `result`; your schema says `route`. That one word flipped one case. With your own schema the SDK scored 6/6, and reading the SDK's source is what found it.
- **Versions churn.** Version 7 had renamed `onStepFinish`, `system` and `stepCountIs`. The docs that ship with the installed version were the reliable source.
- **Near-ties can flip between sessions.** The same prompt wrote a slightly different search query than Module 7's run days before, while two runs in one session matched word for word.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find package 'ai'` | Run Setup's `npm install` |
| A type error about a renamed option (`onStepFinish`, `system`, `stepCountIs`, `maxSteps`) | It's from an older version of the SDK. Look up the current name in `node_modules/ai/docs/` |
| `ERR_REQUIRE_ESM`, or `require() of ES Module` | The SDK only works as ES modules. Run the scripts with `npx tsx`, as above |
| The router's SDK column shows `error: …` | The model's answer wasn't one of the options. `Output.choice` throws where your router falls back to `notes` |
| `The server's tools changed since you pinned them` | That's the pin working. Read the tool's new description; rerun with `--repin` only if you accept it |
| The first step is slow | A cold start, as in every module. Ollama unloads the model after a few minutes of idle |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
