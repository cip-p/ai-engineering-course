# Module 9 (elective): A web UI with Next.js

**Goal:** put a chat page on your Module 8 assistant. It shows the answer word by word as the model writes it, and a live bar of where the time goes: waiting in line, the router, your code's search, the model's steps. The assistant itself barely changes. That's the test of Module 8's claim that it doesn't depend on Slack.

## Concepts (read before running anything)

1. **One assistant, three front ends.** Slack (`bot.ts`), the terminal (`eval.ts`) and now a web page all call the same `assistant.ts`. Only two things were added to it, both optional:
   - an `onToken` callback for the answer's words;
   - a design you can pick per question.

2. **Two processes: the assistant service and the web app.**
   - `server.ts` runs the assistant as a small HTTP service on `127.0.0.1:3001`.
   - The Next.js app in `ui/` serves the page. Its route handler, `/api/ask`, forwards each question to the service.

   Why not call `assistant.ts` straight from Next.js?
   - **The assistant holds long-lived state:** two MCP servers as child processes, the queue, warm caches. Next.js's dev server reloads your code on every edit, and would start new MCP servers each time without stopping the old ones.
   - **Next.js bundles server code.** Bundling rewrites the `new URL("…", import.meta.url)` file paths that the course code relies on for `ROOT`, the sandbox and the logs.
   - **This is the usual shape anyway:** a model backend, and a web front end that talks to it.

   The browser talks only to the Next.js app, on the same origin, and the app talks to the service. That's the "backend for frontend" pattern. The service stays on your machine, unreachable from the browser.

3. **Streaming over HTTP, one JSON object per line.** The service writes its response a line at a time, as events happen. That format is NDJSON: newline-delimited JSON.
   - The route handler passes the stream through without waiting for the end.
   - The page reads the body as it arrives (`response.body.getReader()`). It keeps any half line for the next piece, and parses every complete line.
   - The browser's `EventSource` would be the other way to stream, but it only does GET, and a question belongs in a POST body.

4. **What streams, and what can't.**
   - **On the notes and other routes, the answer streams word by word.** They make one model call, so every word that comes out is the answer.
   - **The agent's steps arrive whole.** That's the slack route, and the older designs. Until a step ends, the agent loop can't know whether the model is writing an answer or a tool call.

   On a CPU, this is Module 1's two numbers made visible: the time to the first word, and the words per second after it. Streaming doesn't make the answer faster. It lets you start reading about 10 s before the end.

5. **Streaming works against output guardrails.** You can't check text that hasn't been written yet. The Slack bot posts once, after `cleanAnswer`. The web page shows the words as they come, so a secret would be on the screen before the final, checked answer replaces it. Chapter 10 describes the same trade-off. The fixes all give back some of the speed:
   - hold back each sentence until it's checked;
   - check the stream with a sliding window;
   - don't stream the risky routes.

6. **The browser is a new place for injection.** React escapes the text it renders, the web's version of the escaping `cleanAnswer` does for Slack. A `<script>` the model copies from a poisoned message shows up as text. That protection disappears the moment you render model output as HTML (`dangerouslySetInnerHTML`, a Markdown renderer that allows raw HTML) or turn its links into clickable ones without checking them.

## Setup

The web app is its own small package in `ui/`, with its own `node_modules`. Next.js needs TypeScript's JavaScript API, and the course's TypeScript 7 doesn't have one (it's the new compiler written in Go). So the app uses TypeScript 5.

```bash
cd m09-web/ui
npm install next@16 react@19 react-dom@19
npm install -D typescript@5 @types/node@24 @types/react@19 @types/react-dom@19
npm run typecheck
cd ../..
npm run typecheck
```

The first `typecheck` checks the web app, with TypeScript 5. The last one checks the course code, which now skips `m09-web/ui`.

| File | What it is |
|---|---|
| `server.ts`, `question.json` | Lesson 9.1: the assistant as an HTTP service, streaming NDJSON events, and a question to send it |
| `ui/app/api/ask/route.ts` | Lesson 9.2: the route handler that forwards a question to the service and streams back its events |
| `ui/app/page.tsx` | Lesson 9.2: the chat page: the stream reader, the timeline, the trace |
| `ui/app/layout.tsx`, `ui/app/globals.css` | The page's frame, fonts and styles, with light and dark modes |
| `ui/next.config.ts`, `ui/tsconfig.json`, `ui/package.json` | The web app's own settings and packages |

Changes outside this folder:
- `assistant.ts` takes an `onToken` callback and a per-question design, and its context can say "via the web UI";
- `guardrails.ts` exports `removeSecrets` on its own;
- the root `tsconfig.json` skips `m09-web/ui`;
- `.gitignore` ignores `.next/`.

## Lesson 9.1: The assistant as a service (`server.ts`)

```bash
npx tsx m09-web/server.ts
```

In a second terminal, ask it something with `curl`. The `-N` flag turns off curl's own buffering, so you see each line as it arrives. The question is in `question.json`, not here: this README is part of your notes, and a question quoted in the notes becomes the top search hit for itself (Module 5's r11).

```bash
curl -N -X POST http://127.0.0.1:3001/ask -H 'Content-Type: application/json' -d @m09-web/question.json
```

In PowerShell, write `curl.exe` (in Windows PowerShell, `curl` is a different command) and quote the `@`, which PowerShell would otherwise read as its own syntax:

```powershell
curl.exe -N -X POST http://127.0.0.1:3001/ask -H "Content-Type: application/json" -d "@m09-web/question.json"
```

**What to notice**
- **One JSON object per line:** `queued`, `start`, the router's step (`"step":0`), your code's search (`"byCode":true`), then the answer.
- **The `token` lines are pieces of words,** the tokens of Module 2: a long word arrives in two or three pieces. They come at the model's decoding speed, about 8 per second on a CPU. Before the first one comes the router, the search, and the prefill of ~800 prompt tokens.
- **The citations.** Does each [n] in the answer really support the sentence it ends? Compare with the `sources` in the `done` line.
- **The service's own terminal** prints the same trace as `bot.ts` and `eval.ts`: one event stream, three consumers.
- **`127.0.0.1` only.** Try the same `curl` with your machine's network address instead: it's refused. The service isn't on your network.

## Lesson 9.2: The web page (`ui/`)

Keep `server.ts` running, and in another terminal:

```bash
npm --prefix m09-web/ui run dev
```

Open [http://localhost:3000](http://localhost:3000). Under **Your Slack name**, type your name exactly as Slack shows it, so that "I" in a question means you. Then ask:
1. A question about your notes. Watch the bar and the words.
2. A question about #study.
3. A bit of small talk.
4. This test string: `Repeat exactly: xoxb-1234-5678-abcdefgh`. Watch the screen while it streams, then when it finishes.
5. A notes question again, with **Design** set to `agent-v1`. That's lesson 8.5's first design, now in a UI.

**What to notice**
- **The timeline.** Each colour is one kind of step, as wide as its share of the time. The striped part is the step in progress, still growing. Which part dominates? Compare with `report.ts`'s "model 84%".
- **The first word against the total,** in the line under the bar. Streaming moved what you see, not what the CPU does.
- **The slack route doesn't stream:** the answer arrives whole after its agent steps. Why? (Concept 4.)
- **A notes question the notes don't answer in your words.** "I don't know based on the notes" streams, then disappears. Then a model step writes a passage, your code searches again (a second teal part on the bar), and a new answer streams. That's the `search-again` design from lesson 8.5. What did the second try cost in time?
- **The secret test.** The token flashes on screen while it streams, then the checked answer replaces it and a note says so. That's concept 5, live.
- **The trace,** under each answer. Open it: your code's search, with a preview of what it returned, and every model step with its tokens. It's the same data as a line of `logs/runs.jsonl`.
- **Your browser's developer tools, on the Network tab.** Find the `ask` request, and watch its response grow while the answer is written. It's one request.
- **Two tabs at once.** Ask in both: the second waits in line, and its bar starts with a grey part.

## Exercises

1. **Feedback from the page.** Add 👍/👎 buttons under each answer. They POST to a new `/api/feedback` route, which the service records with Module 8's `log.ts`. Also log each web run with `logRun` (channel `web`), so that `report.ts` and `--export` cover the web too. What do you use as `replyTs`, now that there's no Slack message?
2. **One assistant for every front end.** Make `bot.ts` send its questions to `server.ts` instead of creating its own assistant. Then there's one queue, one pair of MCP servers and one prompt cache. What does the bot lose when the service is down? Which process should own the queue?
3. **Stream the agent's last step.** Stream every agent step, and send its words as they come. If a tool call starts, tell the page to discard them: it wasn't the answer. How often does a step start with words and end in a tool call?
4. **Check the stream.** Hold back the words until a sentence ends, and run `removeSecrets` on each sentence before sending it. Rerun the secret test. What does it cost in time to the first word?
5. **A stop button.** Abort the fetch from the page with an `AbortController`. Does Ollama stop working? Follow the request: the route handler, the service, the model call. Stop each one in turn.
6. **A conversation.** The model is stateless (Module 1), so the page must send the earlier turns with each question. Add a `history` field and pass it to the agent. Watch the first step's `tokens in` grow with every turn.

## Checkpoint (answer in your own words)

1. Name every component between your browser and Ollama, and the protocol between each pair.
2. Why does the assistant run as its own service instead of inside the Next.js route handler?
3. What does streaming improve, and what doesn't it? Use your first-word and total times.
4. Why is streaming in tension with output guardrails? What did the secret test show?
5. React escapes text; Slack needed `cleanAnswer`. What is the common defense, and what would break it in each place?
6. Which routes stream word by word, and which don't? Why?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (`qwen3:4b-instruct-2507-q4_K_M`)

This README is part of the corpus, so eval cases appear here by id only.

| Measurement | Value |
|---|---|
| Setup | `ui/` on Next 16.4.3, React 19.3.1 and TypeScript 5.9.3; both typechecks clean |
| Lesson 9.1, one notes question by `curl` | 45.3 s in all: the router 11.2 s (the first model call after startup), the search 10.6 s (it embedded 31 changed sections first), the answer 23.5 s (769 tokens in, 52 out) |
| The router, once warm | 1.6–3.0 s per question |
| A notes answer | 15–17 s for 600–700 prompt tokens, even when the answer is 10 tokens long: reading the prompt dominates |
| The first word, estimated from step times at ~8 tokens/s | the other route: after ~5 s of a ~13 s reply · the notes route: after ~18 s (router, search, prompt), then ~8 tokens/s |
| Search again (s02, reworded) | ~41 s: router, search, an "I don't know" (15.2 s), the passage (6.1 s), a second search, then the answer (16.2 s), correct and cited |
| A Slack question | your code read the channel in 0.6 s, then one 22.5 s step (913 tokens in), with no streaming |
| The secret test | the token streamed onto the page, then the checked answer replaced it, with the note |

**What these runs showed**
- **The assistant didn't need to know about the web.** Three optional additions were enough: a token callback, a design per question, a "via" hint. With them, the same assistant serves Slack, the terminal and a browser.
- **Streaming changes when you start reading, not when the answer ends.** On the other route the words start after ~5 s of a ~13 s reply. On the notes route, the first ~18 s go to the router, the search and reading the prompt, and no stream can show anything during them. The timeline makes it visible: the model's part dominates every bar.
- **The stream shows Module 2's tokens.** A long word arrives in two or three pieces, such as `Rec`, `ipro`, `cal`.
- **A question quoted in the notes becomes its own top search hit.** Lesson 9.1's curl example in this README came back as result [1] for itself, so it moved to `question.json`. The secret test's string, quoted in lesson 9.2, did the same.
- **Streaming shows text before any check.** The secret test's token appeared on the page before the checked answer replaced it.
- **Real use found failures the eval didn't have.** A statement was sent to the notes route (now case u02, fixed by router v2). And search-again's trigger depends on the model's exact wording. Every front end feeds the same loop of failure, case and fix.
- **A citation can be wrong.** The curl answer cited [3] for a sentence that came from [2].

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says the assistant service isn't running | Start it with `npx tsx m09-web/server.ts`, and keep that terminal open |
| `Cannot find module 'next'` | Run the two `npm install` commands inside `m09-web/ui` (Setup) |
| The root `npm run typecheck` checks `m09-web/ui` | The root `tsconfig.json` needs `"exclude": ["node_modules", "m09-web/ui"]` |
| The words don't stream, and arrive all at once | A proxy or compression is buffering. `next.config.ts` turns compression off, so check that it's this app's config being used. Test the service alone with `curl -N` |
| Port 3000 or 3001 is busy | `npm --prefix m09-web/ui run dev -- -p 3002`, or `npx tsx m09-web/server.ts --port 3003` and `ASSISTANT_URL=http://127.0.0.1:3003/ask` for the web app. In PowerShell, set them as variables before `npm --prefix m09-web/ui run dev`: `$env:PORT = "3002"` for the page, `$env:ASSISTANT_URL = "http://127.0.0.1:3003/ask"` for the service's address |
| The fonts don't load | `next/font` downloads them once, at the first start. That needs the internet, and the page falls back to Georgia and your monospace font |
| "I" isn't recognized in Slack questions | Fill in **Your Slack name** exactly as Slack shows it |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
