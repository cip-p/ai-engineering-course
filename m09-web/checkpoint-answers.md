# Module 9 (web UI) checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the runs in [Reference results](README.md#reference-results-qwen34b-instruct-2507-q4_k_m). This file isn't part of the search corpus (only `README.md` is), so it can quote the questions and their answers.

## 1. Name every component between your browser and Ollama, and the protocol between each pair.

```
Browser: page.tsx, a React client component
  │ HTTP POST /api/ask on localhost:3000 (same origin), body read as a stream of NDJSON lines
  ▼
Next.js dev server: the route handler app/api/ask/route.ts
  │ HTTP POST 127.0.0.1:3001/ask (fetch), its streamed body passed straight back
  ▼
m09-web/server.ts: node:http, the one-at-a-time queue, toWire()
  │ function calls in the same process
  ▼
m08-slack/assistant.ts: the router, then a route
  ├─ the router and every answer ── OpenAI-compatible HTTP to localhost:11434 ──▶ Ollama (Qwen3 4B)
  │     answers that stream use stream: true, which arrives as server-sent events ("data: {…}" lines)
  ├─ search_notes ── MCP JSON-RPC over stdio ──▶ notes-server.ts
  │     └─ Module 5's retriever: nomic-embed-text in Ollama (HTTP), BM25 and RRF
  └─ read_channel ── MCP JSON-RPC over stdio ──▶ slack-server.ts ── HTTPS ──▶ Slack's Web API
```

**On the way back:**
1. Each streamed chunk from Ollama calls `onToken`.
2. `server.ts` writes a `{"type":"token"}` line.
3. Next.js passes it on.
4. The page's reader parses it and updates the React state.

So the answer changes format twice: server-sent events from Ollama, then NDJSON lines to the page.

## 2. Why does the assistant run as its own service instead of inside the Next.js route handler?

- **It holds long-lived state:**
  - two MCP servers as child processes;
  - the queue;
  - a warm prompt cache in Ollama.

  Next.js's dev server reloads your modules on every edit. Inside a route handler, each reload would start new MCP servers and orphan the old ones. In production, route handlers often run as short-lived functions that can't keep child processes at all.
- **Bundling would break the course code.** Next.js bundles server code, which rewrites the `new URL("…", import.meta.url)` paths that `ROOT`, the sandbox folder and the logs depend on.
- **Two toolchains.** The course runs TypeScript 7 with `tsx`. Next.js needs TypeScript 5, for its JavaScript API.
- **It's the shape that scales:**
  - one model backend, several front ends (exercise 2 puts the Slack bot on it too);
  - the backend stays on `127.0.0.1`, unreachable from the browser;
  - the Next.js app is a thin "backend for frontend".

## 3. What does streaming improve, and what doesn't it?

**It improves *when you can start reading*.** On the other route, your RAG statement's reply started after ~5 s of its ~13 s total, estimated from the step times at ~8 tokens/s. You were reading for 8 of those seconds instead of watching a spinner.

**It doesn't improve:**
- **The time to the first word itself.** On the notes route, the first ~18 s go to the router, the search and reading 600–900 prompt tokens. Nothing can stream before the model has read its prompt. That was the 15–17 s for a 10-token "I don't know".
- **The total time, the CPU work, or correctness.** Streaming showed a wrong interim answer too: the "I don't know" that search-again then discarded.
- **The Slack route.** Its agent steps arrive whole: 22.5 s of nothing, then the full answer.

**The lesson from the timeline:** on your machine, the model's reading time dominates every bar. Streaming hides the writing, but only routing, shorter prompts and caching cut the reading.

## 4. Why is streaming in tension with output guardrails? What did the secret test show?

**A guardrail checks text, and streaming shows the text before it's complete.** A check that looks at the whole answer can only run at the end. By then, every word has already been on the screen.

The secret test showed exactly that:
- the fake `xoxb-…` token streamed onto the page;
- then the final answer, checked by `removeSecrets`, replaced it with `[secret removed]`, and the note said so;
- you saw the secret anyway, and so could a screenshot or someone looking over your shoulder.

The Slack bot never has this problem: it posts once, after `cleanAnswer`.

**The fixes all give back some of the speed:**
- **Hold back each sentence until it's checked** (exercise 4). That delays the first word by up to one sentence, 2–4 s at 8 tokens/s.
- **Check a sliding window of recent text.** A token can be split across chunks, such as `xo` + `xb-12`, so a check that looks at one chunk at a time misses it.
- **Don't stream the risky routes.**
- **Check the input first,** so the risky text is never generated.

## 5. React escapes text; Slack needed `cleanAnswer`. What is the common defense, and what would break it in each place?

**The common defense is output encoding.** Treat the model's text as untrusted data, and encode it for the place where it's displayed:
- **Slack:** escape `&`, `<` and `>`, so `<!channel>`, `<@U…>` and labelled links become plain text.
- **React:** text in JSX is escaped automatically, so a `<script>` or `<img onerror=…>` the model copied from a poisoned message shows up as characters.

**What breaks it in Slack:**
- **A path that skips `cleanAnswer`.** `post_message` in `slack-server.ts` posts raw text.
- **Formatting the model can control,** such as Block Kit blocks built from its text, or `link_names: true`.

**What breaks it on the web:**
- `dangerouslySetInnerHTML`;
- a Markdown renderer that allows raw HTML;
- a model-supplied URL used as an `href`, which can be a `javascript:` link;
- model text placed in attributes, styles or scripts.

**In both places, encoding stops markup, not meaning.** A poisoned sentence that reads as a real request still gets through (Module 6's t09).

## 6. Which routes stream word by word, and which don't? Why?

**Streaming, through `once()` with `onToken`:**
- **The notes route:** one model call, whose every word is the answer.
- **The other route:** the same.
- **search-again's first answer** streams too, and is then discarded when it says "I don't know". The second answer streams in its place.

**Not streaming:**
- **The agent's routes:** the slack route, and the three designs before the router. `runAgent` uses non-streaming calls. Even if it streamed, a step's output can turn out to be a tool call instead of an answer, and you can't know which until the step ends. Exercise 3 streams it anyway, and discards the words if a tool call appears.
- **The router:** its output is a JSON choice for your code, not words for you.
- **The HyDE passage:** it's only used to search, and you're not meant to read it. It names a book that isn't the right one.
