# Module 8: Capstone, a Slack study assistant

*Book: ch. 10 (AI engineering architecture and user feedback)*

**Goal:** put the course together. You build a Slack bot that answers questions about your notes and your channels. It uses your local model, your Module 6 agent and your MCP servers. Around it you add the engineering that chapter 10 describes: guardrails, observability and user feedback, and a loop that turns bad answers into eval cases.

## Concepts (read before running anything)

1. **The architecture, layer by layer.** Chapter 10 builds an AI application in steps:
   - the model alone;
   - more context (RAG, tools);
   - guardrails;
   - a router and a gateway;
   - caches against latency;
   - agent patterns, including actions that write;
   - monitoring of all of it.

   Your bot has most of them:
   - **context:** your notes and Slack, through MCP;
   - **guardrails:** in code, on both sides of the model;
   - **a router, then a pipeline or an agent:** one short model call picks a route. Questions about the notes go to Module 5's pipeline. For questions about Slack, your code reads the channel, then Module 6's agent answers;
   - **monitoring:** logs and feedback;
   - **a gateway:** `common/llm.ts` has been one since Module 1, the one place that decides which model and provider answer.

   Caching is an exercise, because on your machine you'll want to measure what it buys. The router started as an exercise too; lesson 8.5 measures the designs that led to it.

   ```
   you in Slack: "@study-buddy …"
     │  Slack pushes the event down a WebSocket (Socket Mode)
     ▼
   bot.ts ─ input guardrails ─ 👀 ─ waits in line
     │
     ▼
   assistant.ts ─ the router picks a route ◀──▶ Ollama (Qwen3 4B)
     │  notes: search, then one answer with citations
     │  slack: read the channel, then the Module 6 agent with the Slack tools
     │  other: one answer, no tools
     │  MCP over stdio
     ├──▶ notes-server.ts   search_notes (Module 5's retrieval)
     └──▶ slack-server.ts   read_channel, search_messages ──▶ Slack's Web API
     │
     ▼
   bot.ts ─ output guardrails ─ reply in the thread, with sources
     │
     ▼
   logs/runs.jsonl, logs/feedback.jsonl (👍/👎)
     │
     ▼
   report.ts ── 👎 becomes a case in cases.json ──▶ eval.ts
   ```

2. **Socket Mode: events over a WebSocket.** Slack normally delivers events by POSTing them to your app's public HTTPS address, through the Events API. Your laptop has no public address. In Socket Mode it doesn't need one:
   - the app opens a WebSocket *out* to Slack, and Slack pushes every event down it as a JSON "envelope";
   - the app must acknowledge each envelope within 3 seconds, or Slack sends it again;
   - Bolt, Slack's SDK, acknowledges as soon as the event arrives, so your code can take a minute to answer;
   - a resend can still happen, so `bot.ts` remembers which messages it has answered.

   It's Module 7's two transports again:
   - **Socket Mode is like stdio:** private, with nothing listening on your machine.
   - **The Events API is like Streamable HTTP:** a URL others can reach, so Slack signs every request and the app has to check the signature.

3. **Two tokens, and scopes.**
   - **The app-level token (`xapp-…`)** only opens the WebSocket (scope `connections:write`). It can't read or post anything.
   - **The bot token (`xoxb-…`)** is the bot's identity for Slack's Web API. It can do exactly what its *scopes* allow, and nothing else. Scopes are set in the app's manifest, and changing them means reinstalling the app.
   - **It isn't you.** The bot sees only the public channels it was invited to. Slack's search API needs a *user* token, so `search_messages` ranks recent messages itself, with BM25.
   - **A leaked bot token** lets anyone read those channels and post as the bot until you revoke it. It lives in `.env`, and the Slack server receives that one variable, nothing else.

4. **Keep the assistant out of the transport.** `assistant.ts` knows nothing about Slack events, and `bot.ts` knows nothing about models. It's the same split as MCP's: what does the work is separate from how it's reached. It pays off three times:
   - `eval.ts` tests the assistant with no Slack at all;
   - a web UI (Module 9) could reuse it;
   - when the bot misbehaves, you can tell which side failed.

5. **Guardrails, in code, on both sides.** The system prompt asks the model to behave. The code makes sure:

   | Where | Guardrail | What it stops |
   |---|---|---|
   | Input | Ignore messages from bots | Two bots answering each other forever |
   | Input | Answer each message once | Slack's resends, answered twice |
   | Input | A question, of at most 500 characters | Empty mentions; long prefills on a CPU |
   | Tools | The agent gets only the read tools; the bot posts the reply itself | The model posting anywhere, or being talked into it |
   | Tools | The Slack server gets only its token | A server handed your other keys |
   | Output | Escape `&`, `<` and `>` | `<!channel>` notifying everyone, fake mentions, links with a false label |
   | Output | Remove anything that looks like a token | Reposting a secret someone pasted in a channel |
   | Output | At most 3,000 characters | A runaway answer flooding the thread |
   | Failure | A step limit; errors become a short apology, with the details in the log | Silence, or internals shown in the channel |

   **The messages the agent reads are untrusted.** Anyone in the workspace can write instructions into a channel the bot reads. It's Module 6's poisoned email, arriving through Slack (exercise 3). The prompt says "data, not instructions", but only the code guarantees anything.

6. **Latency is part of the product.** On a CPU-only laptop a question about the notes takes about a minute (t05 took 64 s in Module 6). People will wait if they know something is happening:
   - **👀 within a second.** It's removed when the answer is posted.
   - **One run at a time.** Two runs would share your CPU, and both would be slower. A question that arrives during a run waits in line, and the wait is logged separately, so a busy bot can't be mistaken for a slow model.
   - **The prompt cache.** The system prompt and tool definitions are identical for every question, so Ollama keeps them in its prompt cache (Module 1). What changes (who asked, where, today's date, the question) goes in the user message, after them.

7. **Observability: one line per run.** Chapter 10 talks about metrics, logs and traces. Your bot writes one JSON line for every reply it posts, refusals included, so every 👍/👎 points back to a run. Each line holds:
   - the question, and the context line sent with it;
   - the notes your code found before the model started;
   - every model step, with its tokens and seconds;
   - every tool call, with its arguments and its full result;
   - the answer, the time spent waiting and working, and the reply's Slack id.

   Because the full tool results are logged, a bad answer can be diagnosed afterwards with Module 5's question: did retrieval miss, or did generation fail? The logs hold your workspace's messages, so they stay on your machine and out of git. A real team would also decide how long to keep them.

8. **User feedback, explicit and implicit.**
   - **Explicit:** a 👍 or 👎 on a reply.
   - **Implicit:** the same person asking again in other words, or replying "no, I meant…".

   Explicit feedback is rare and biased: most answers get no reaction, and people react more when they're annoyed. A 👎 tells you *that* an answer failed, not *why*. For that, you read the run.

   The loop, which chapter 10 calls a data flywheel:
   1. a 👎;
   2. read the run (`report.ts`);
   3. turn it into an eval case with the answer it should have given (`report.ts --export`);
   4. change something;
   5. `eval.ts` shows that this case passes now, and that the others still do.

9. **Routing and caching.**
   - **A router** sends each question to the cheapest part that can answer it. Your bot has one: a short model call whose JSON schema allows only `notes`, `slack` or `other` (Module 3's constrained decoding). Notes questions go to Module 5's pipeline, one search and one model call with citations; only Slack questions need the agent. A wrong route means a wrong answer, so when unsure the router picks `notes`, whose prompt says "I don't know" rather than guess.
   - **A cache** answers a repeated question without the model (exercise 7).

   Both trade some correctness for speed, so measure them with `eval.ts` and `report.ts`.

## Setup

### 1. Install

```bash
npm install @slack/bolt@4 @slack/web-api@7
npm run typecheck
npx tsx --test m08-slack/guardrails.test.ts
```

### 2. A workspace and a channel

Use the new free workspace from the Accounts table in `COURSE.md`. If you don't have one yet, create it at [slack.com/get-started](https://slack.com/get-started). In it, create a channel called **#study**, and post three or four messages there: what you learned this week, a question you still have. The bot will read them in lesson 8.3.

### 3. Create the app from its manifest

A manifest describes the whole app in one file: its name, bot user, scopes, events, and Socket Mode.
1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**.
2. Pick your course workspace.
3. On the **YAML** tab, paste the contents of `m08-slack/manifest.yaml`. Click **Next**, then **Create**.

The bot's scopes, and why it needs each one:

| Scope | Lets the bot |
|---|---|
| `app_mentions:read` | receive the `app_mention` event when someone writes @study-buddy |
| `channels:history` | read messages in the public channels it's in |
| `channels:read` | turn a channel name into its id |
| `chat:write` | post its replies |
| `reactions:read` | receive the `reaction_added` event: your 👍 and 👎 |
| `reactions:write` | add and remove 👀 |
| `users:read` | show people's names instead of their ids |

### 4. The app-level token, for Socket Mode

On the app's **Basic Information** page, find **App-Level Tokens** and click **Generate Token and Scopes**. Name it `socket`, add the scope `connections:write`, and click **Generate**. Copy the `xapp-…` token.

### 5. Install the app, and copy the bot token

In the left sidebar, open **Install App** → **Install to *your workspace*** → **Allow**. Copy the **Bot User OAuth Token** (`xoxb-…`). Add both tokens to `.env`, without quotes:

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_APP_TOKEN=xapp-…
```

### 6. Invite the bot

In #study, send: `/invite @study-buddy`

| File | What it is |
|---|---|
| `manifest.yaml` | The Slack app: its bot user, scopes and events, with Socket Mode on |
| `slack-app.ts` | The Bolt app in Socket Mode, shared by `echo.ts` and `bot.ts` |
| `echo.ts` | Lesson 8.1: the smallest bot, to check the setup |
| `slack-server.ts` | Lesson 8.2: Slack as an MCP server: `read_channel`, `search_messages`, `post_message` |
| `assistant.ts` | Lesson 8.3: the assistant, with no Slack in it: a router, then Module 5's pipeline for notes questions or the agent with the Slack tools |
| `guardrails.ts`, `guardrails.test.ts` | Lesson 8.3: the input and output checks, and their tests |
| `bot.ts` | Lessons 8.3–8.4: Slack events in, guarded replies out, every run logged |
| `log.ts` | Lesson 8.4: the JSONL logs, `logs/runs.jsonl` and `logs/feedback.jsonl` (gitignored) |
| `report.ts` | Lesson 8.4: a summary of the logs, and 👎 answers exported as eval cases |
| `cases.json`, `cases.ts`, `eval.ts` | Lessons 8.4–8.5: the bot's eval, run offline, on any of the six designs |

Changes outside this folder:
- `runAgent` takes an `instructions` option (`m06-agents/agent-loop.ts`), so the assistant has its own system prompt;
- `connect()` takes an `env` option (`m07-mcp/mcp-tools.ts`), so the Slack server receives its token;
- `.gitignore` ignores `m08-slack/logs/`.

## Lesson 8.1: Hello, Slack (`echo.ts`)

```bash
npx tsx m08-slack/echo.ts
```

In #study, type `@`, pick **study-buddy** from the list so that it becomes a real mention, and write `hello`. The bot replies in a thread with what Slack sent it.

**What to notice**
- **The event in your terminal.** The text starts with `<@U…>`: that's how Slack writes a mention, as the bot's user id in Slack's markup. `channel` and `user` are ids too.
- **`ts`, a message's id,** is a timestamp such as `1761998400.123456`. The reply passes it as `thread_ts`, which is how Slack knows which thread it belongs to.
- **Nothing on your machine listens for connections.** `echo.ts` connected out to Slack.

Now stop it (Ctrl+C), run `npx tsx m08-slack/echo.ts --debug`, and mention the bot again. Bolt's debug log shows each message on the WebSocket, and the acknowledgement it sends back, matched by an `envelope_id`. It's the same idea as the request ids in Module 7's JSON-RPC.

## Lesson 8.2: Slack as an MCP server (`slack-server.ts`)

```bash
npx @modelcontextprotocol/inspector -e SLACK_BOT_TOKEN="$(grep '^SLACK_BOT_TOKEN=' .env | cut -d= -f2-)" npx tsx m08-slack/slack-server.ts
```

In PowerShell, read the line into a variable first:

```powershell
$token = (Select-String -Path .env -Pattern '^SLACK_BOT_TOKEN=').Line.Split('=', 2)[1]
npx @modelcontextprotocol/inspector -e SLACK_BOT_TOKEN=$token npx tsx m08-slack/slack-server.ts
```

The `$(…)` part (or `$token`) reads one line of `.env`, so the server gets the bot token and nothing else. Click **Connect**, then **Tools → List Tools**, and try:
1. `read_channel` with `study`;
2. `search_messages` with a word from one of your messages;
3. `read_channel` with a channel the bot isn't in;
4. `post_message` to `study`. This time you are the human approving the call.

**What to notice**
- **Names, not ids.** The server turns `<@U…>` into people's names, and `study` into the channel's id. The model reads names and writes names.
- **A channel the bot isn't in** gives a tool error (`isError`) that lists the channels it can see, so the model can recover from it.
- **`search_messages` isn't Slack's search,** which a bot token can't use. It's Module 4's BM25 over the latest messages, run inside the server.
- **The annotations** in the `tools/list` response (History panel): `post_message` is the only tool marked `readOnlyHint: false`.
- **The token's scopes are the real limit.** The bot has no scope to delete messages or read private channels, so no prompt can make this server do either.

## Lesson 8.3: The assistant (`bot.ts`)

```bash
npx tsx m08-slack/bot.ts
```

It starts both MCP servers and lists the tools the agent gets. Then try these in #study:
1. A question about your notes, such as `@study-buddy what does Reciprocal Rank Fusion do?`
2. A question about the channel, such as `@study-buddy what has been posted in this channel?`
3. A question your notes can't answer.
4. Two questions, one right after the other.
5. A mention with no question at all.

**What to notice**
- **👀 within a second, the answer about a minute later,** in a thread. Your terminal shows the same trace as Module 6.
- **Step 0 is the router:** one short model call that picks `notes`, `slack` or `other`. The reply's last line shows its choice. Did each question take the route you would have picked?
- **On the notes route, a `── tool search_notes` comes before step 1.** That's your code searching, not the model's choice. Then a single model call answers, citing [1] or [2], and the sources listed are the passages it cites: what it used, not just what it read.
- **On the slack route, a `── tool read_channel` comes before step 1.** That's your code reading the channel you asked in. Does the answer use the messages' dates and authors? Does the model ever call `search_messages` for another channel?
- **The second of two quick questions waits.** Send them as two separate mentions. The terminal says so, and the waiting time goes in the log.
- **`tokens in` on the notes route's step 1:** Module 5's short prompt, about 600 tokens of notes and the question. There are no tool definitions at all, where Module 6's five tools alone took 532 tokens.
- **The context line** at the top of the user message: who asked, in which channel, and today's date, which "today" questions need.

## Lesson 8.4: Observe, then improve (`report.ts`, `eval.ts`)

1. React 👍 or 👎 to the bot's replies. Give a 👎 to at least one wrong or unhelpful answer.
2. Read the report:
   ```bash
   npx tsx m08-slack/report.ts
   ```
3. Export the 👎 answers as eval cases:
   ```bash
   npx tsx m08-slack/report.ts --export
   ```
   Open `cases.json`, and for each new case, write `expected` (the strings a right answer must contain) and `route` (the route it should take).
4. Stop `bot.ts` (Ctrl+C), so a mention can't share your CPU with the eval. Then run the eval. It needs only Ollama: like `bot.ts`, it starts its own MCP servers and stops them at the end.
   ```bash
   npx tsx m08-slack/eval.ts
   ```

**What to notice**
- **The median against the p90.** One slow answer (a cold start, a second search) hides in an average.
- **Where the time goes:** the model, the tools, or waiting in line.
- **The feedback rate.** How many answers got any reaction, even from you, who knows this is an experiment?
- **Each 👎 with its route and tool calls.** Was it a wrong route, a retrieval miss (the search result in `logs/runs.jsonl` doesn't contain the answer), a wrong decision (no tool at all), or the generation?
- **The router's own score.** `eval.ts` checks the router first, on every case with a `route`, including the cases with no expected answer yet. When an answer is wrong, this tells you whether the question even went the right way.
- **The eval runs the same assistant, with no Slack event.** A case about a channel depends on what's in the channel today, so its result can change without any change to your code. Prefer notes questions as eval cases, or freeze the channel's data.

## Lesson 8.5: Improve it, measured (`eval.ts --design`)

`assistant.ts` keeps six designs of the same assistant, in the order they were built. Its `FEATURES` table shows what each one adds. Each one exists because the eval found a failure in the one before it. Run them in order, on the same cases. Each run takes a few minutes:

```bash
npx tsx m08-slack/eval.ts --design agent-v1
npx tsx m08-slack/eval.ts --design agent
npx tsx m08-slack/eval.ts --design search-first
npx tsx m08-slack/eval.ts --design router
npx tsx m08-slack/eval.ts --design read-first
npx tsx m08-slack/eval.ts --design search-again
```

The cases need a Slack one, with an expected answer, for the last two designs to differ. `cases.json` ships with the author's (f51f89e), which can only pass on the author's channel. Lesson 8.4's export gives you your own: write its `expected` with a word from your own post, and replace f51f89e with it.

| Design | What changes | What to look at in its results |
|---|---|---|
| `agent-v1` | Module 6's agent with the three read tools, and a first prompt ending "If they don't answer the question, say so." | The "tools the model called" column. What do the answers claim about the notes, and did it read any? |
| `agent` | Only the prompt: it says what the tools can reach, and in which order to work: a tool first, then the answer | Which cases search now? Compare their wording with the prompt's own words |
| `search-first` | Your code searches the notes with the question before the model starts; the model may search again | Which failure is left, and in which layer: the decision, retrieval or the generation? Does the model ever search again? |
| `router` | One short model call picks a route: notes (Module 5's pipeline), slack (the agent with the Slack tools only) or other | The router's own score, the time per case, s02, and the Slack case's tool calls |
| `read-first` | On the slack route, your code reads the channel the question was asked in before the model starts | The Slack case. Is anything left for the model to decide? |
| `search-again` (the default) | Two changes, each with its own check. The router's examples now include statements (the router's score on u02). On the notes route, an "I don't know" makes your code search again, with a passage the model writes of what the notes might say (the score on s02) | Does s02 pass now? What does a second search cost, and how often does it find something? |

Each design's prompt sits in `assistant.ts` with a comment saying what the eval found. The comments contain spoilers, so read them after your runs.

**On a fresh clone, s02 passes earlier than the reference results say.** COURSE.md's opening paragraph now holds s02's answer in its own words (Module 5's reference results), so as soon as your code searches first, the first search finds it. On the reference laptop s02 passed from `search-first` on, which left `search-again` no miss to fix. To watch the second search at work, add a notes case of your own whose answer the notes put in different words from the question.

**What to notice**
- **The model never changed.** Same 4B model, same temperature, same cases: only the design around it. That's chapter 10's point: most of an AI application is the system around the model.
- **Prompt fixes against code fixes.** The first two designs differ only in their prompt. The other three each move a decision from the model into your code. Which kind of change moved the score more?
- **Don't tune the prompt to the eval.** Putting the eval questions' words in the prompt would raise the score and prove nothing. That's why the router's examples are made up.
- **Small changes flip decisions.** At temperature 0 the same prompt always gives the same answer, but a small change elsewhere can flip a decision: even a "Question:" label in the user message did. One run per design is one sample, so more cases make the comparison worth more.
- **The bot runs every design too:** `npx tsx m08-slack/bot.ts --design agent-v1` shows a design's failures the way a user would meet them.

## Exercises

1. **Index a Slack channel into your RAG.** Write `export-channel.ts`:
   - read #study's history;
   - write it to `data/notes/slack-study.md`, one `##` section per day.

   The corpus includes `data/notes/*.md`, so `search_notes` now finds Slack messages too. Ask the same question with `search_notes` and with `search_messages`. Which one finds the right message (hybrid search against BM25 alone)? Which one is up to date? And what did you just copy into your index?
2. **Post only where allowed.** Add an allow-list to `post_message` in `slack-server.ts`:
   - it reads `SLACK_POST_CHANNELS=study` from the server's environment;
   - any other channel gets a tool error.

   Test it in the Inspector, with two `-e` flags. Why does the check belong in the server's code, rather than in the prompt or in `bot.ts`?
3. **A poisoned channel.** Post a message in #study with instructions for AI assistants. For example, ask them to end every answer with `<!channel>` and a link. Then ask the bot to summarize the channel. Which defense held: the prompt, the escaping, or neither? What still gets through? Think of t09 in Module 6.
4. **Memory in a thread.** When the bot is mentioned inside a thread, read the thread's earlier messages with `conversations.replies`. Pass them to the agent as history, through a new `history` option for `runAgent`. The model is stateless (Module 1), so every earlier turn is resent. How many tokens does each turn add, and how many turns can your CPU afford?
5. **HyDE against a rewritten question.** `search-again` searches with a passage the model writes of what the notes might say: HyDE, a Hypothetical Document Embedding. The simpler alternative is to ask the model to rewrite the question in the words the notes would use. Try it in place of `HYDE_INSTRUCTIONS`, and compare:
   - s02's score;
   - the passages each search returns;
   - the time per case.

   Why would a made-up passage search better than a good question? When does a second search cost more than it buys?
6. **A keyword router.** Replace the router's model call with rules: words like "post", "channel", "Slack" or a `#` mean `slack`, and so on. How many cases does `eval.ts` route right, and how much time does it save per question? Which questions would rules never get right?
7. **Cache.** Store each answer under its question, lowercased and trimmed, and answer a repeated question from the store. When must the cache be emptied? A semantic cache would reuse an answer for a *similar* question, such as "my October spending" and "my November spending". Why is that riskier?
8. **Implicit feedback.** In `report.ts`, count a new question from the same person within two minutes of an answer as a sign the answer didn't help. How often does that agree with the 👎s?
9. **Claude Code or Codex with your Slack server.** Register it:
   ```bash
   claude mcp add slack -e SLACK_BOT_TOKEN=xoxb-… -- "$PWD/node_modules/.bin/tsx" "$PWD/m08-slack/slack-server.ts"
   # or
   codex mcp add slack --env SLACK_BOT_TOKEN=xoxb-… -- "$PWD/node_modules/.bin/tsx" "$PWD/m08-slack/slack-server.ts"
   ```
   In PowerShell, start tsx with `node`, as in Module 7's lesson 7.3:
   ```powershell
   claude mcp add slack -e SLACK_BOT_TOKEN=xoxb-… -- node "$PWD\node_modules\tsx\dist\cli.mjs" "$PWD\m08-slack\slack-server.ts"
   # or
   codex mcp add slack --env SLACK_BOT_TOKEN=xoxb-… -- node "$PWD\node_modules\tsx\dist\cli.mjs" "$PWD\m08-slack\slack-server.ts"
   ```
   Ask the assistant to summarize #study, then to post the summary there. Who approves `post_message` this time? Which tools would you let it use without asking? Where did your token get stored?
10. **Freeze a Slack case.** An eval case about a channel drifts: every question you ask the bot adds a message, and "today" moves. Make one that can't:
    - create a channel `#fixture`, invite the bot, post two or three messages, and never mention the bot there;
    - let a case's `context` carry a fixed `today`, which `assistant.ts` uses instead of the real date;
    - add a case that asks about `#fixture` on that day.

    Keep the live case next to it. When the live case fails and the frozen one passes, what changed: your code or the channel?

## Checkpoint (answer in your own words)

1. Draw the path from a Slack message to the bot's reply, and name every component on it. Which of them run on your machine, which run at Slack, and which protocol connects each pair?
2. Which guardrails are enforced by code, and which only by the prompt? For one of each, give a failure it stops and one it doesn't.
3. Where did the time go in your bot's answers? Use `report.ts`'s numbers. Which lever from chapter 10 would help most on your machine, and what would it cost?
4. Why does the bot post the reply itself instead of giving the model `post_message`? What would change if the agent could post?
5. Someone reacts 👎 to an answer. Walk through what you do, from the log line to a passing eval case. How do you know the fix didn't break anything else?
6. What can the bot token do that the app-level token can't, and the other way round? What could someone do with your bot token?
7. Your assistant went through six designs with the same model. Which change moved the score most: a prompt change or a code change? Why?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (`qwen3:4b-instruct-2507-q4_K_M`)

This README is part of the corpus, so the eval cases appear here by id only.

| Measurement | Value |
|---|---|
| Setup | The app from the manifest worked in Socket Mode: the echo bot, a `post_message` from the Inspector, and the bot |
| Guardrail tests | 7/7 pass |
| Eval by design, s01–s03 | agent-v1 **0/3** · agent **1/3** · search-first **2/3** · router **2/3** · read-first **2/3** · search-again **3/3** |
| Time per case | agent-v1 4.3 s · agent 14.8 s · search-first 29.5 s · router 28.0 s · read-first 20.4 s · search-again 30.2 s (the last two over 4 cases, the Slack one included) |
| Router | v1: 5/5 on every run · v2: 6/6, with u02 added from the web UI. 1.2–2.3 s per call once cached, 10–13 s the first time |
| Search again (s02) | 4 model calls and 41.8 s, against ~20 s for a plain "I don't know": the second try costs ~20 s, and only on a miss |
| The Slack case, f51f89e | router: routed right, then no tool call and a claimed read · read-first: the channel read correctly, the answer incomplete |
| The agent's step 1, without notes | ~480 tokens (instructions, three tools, question). With the notes searched first: ~1,100 |
| Bot, 7 runs | median 32 s, p90 77 s; model 84% of the time, tools 2%, waiting in line 14% |
| Queue | one question waited 31.8 s while the one before it ran |
| Feedback | 👍 2 · 👎 1 · 43% of the replies got a reaction · 1 reaction on a reply that no run had logged |

**What these runs showed**
- **The same model went from 0/3 to 2/3 with no change to the model.** Every step that held was a decision moved from the model into your code: search first, the router, read first. The one prompt fix moved one case, and its new answers claimed a search that never happened.
- **"Claimed, not done" is this model's typical failure.** It reported "I couldn't find it in the notes" without searching, and "I read the latest 20 messages from #study" without reading. Each time, the prompt had handed it the sentence: an instruction about what to say after an action gives a small model words to recite instead of acting.
- **Each fix moved the failure down a layer.** s02 went from no search, to a search that misses (Module 5's vocabulary mismatch), to an honest "I don't know". f51f89e went from no read, to a correct read with an incomplete answer: among a dozen messages, most of them questions to the bot, it missed the first posts.
- **HyDE fixed the miss no earlier design could.** s02 is Module 5's r12 and Module 6's t06, a vocabulary mismatch that failed in every module. After an "I don't know", the model wrote the passage it expected the notes to contain, your code searched with it, and the search found the right line. A made-up passage searched better than the real question, because it was written in the notes' kind of words. In the web UI the passage even named the wrong book and the wrong authors, and its search still found the right line: it searched with its words, not its facts. The wrong facts never reached the answer, because only the passages found go into the answer's prompt.
- **A trigger in code depends on how reliably the model words its output.** Search-again fires only on Module 5's exact "I don't know" sentence. A reworded question got a hedged non-answer instead ("the title is not mentioned in the sources"), and no second search ran.
- **The router was cheap and always right.** 5/5 on every run. With no tool definitions in the notes prompt, a case took less time than with search first, despite the extra model call.
- **A fixed pipeline gets in the way of the questions it wasn't built for.** With search first, a Slack question got notes passages about Slack, this module's own README, and the model answered "I couldn't find it" without reading the channel. That's what the router is for.
- **The model takes 84% of the time.** The queue did its job: a question waited 31.8 s instead of sharing the CPU with the one before it.
- **Observability caught a hole in itself.** The first 👎 landed on a refusal that had no line in the log, so it couldn't be traced. Every reply gets a line now, and `report.ts` counts reactions it can't trace. A 👍 and a 👎 placed on the wrong replies showed how noisy explicit feedback is. The run shown behind each reaction is what made it noticeable.
- **A small prompt change flips a decision.** Adding a "Question:" label to the user message made the agent search on s02, which it hadn't done before.
- **Live eval cases drift.** f51f89e depends on what's in #study and on today's date, and every test question adds a message (exercise 10).

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing Slack tokens` | Setup step 5. Write the values in `.env` without quotes |
| The bot doesn't react to a mention | Is `bot.ts` (or `echo.ts`) running? Is the bot in the channel (`/invite @study-buddy`)? Did you pick it from the `@` list, so that it's a real mention? |
| `not_in_channel` | Invite the bot: `/invite @study-buddy` |
| `missing_scope` | Add the scope to `manifest.yaml` and to the app's **App Manifest** page, then reinstall it (**Install App → Reinstall**) |
| `invalid_auth` or `not_authed` | A token is wrong or was revoked. Copy it again (setup steps 4 and 5) |
| The first answer takes several minutes | The notes server is embedding this new README's sections. It happens once |
| `ratelimited` | Slack limits how often an app may call some methods. Wait a minute |
| Reactions aren't logged | Only 👍 and 👎 on the bot's own replies count, and only while `bot.ts` is running |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
