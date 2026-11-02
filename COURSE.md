# AI Engineering: Hands-on Course

A practical course on building with language models, written as a companion to *AI Engineering* by Chip Huyen (O'Reilly, 2025). The book is optional: each module names the chapters it relates to, and explains what it needs on its own.

**Goal:** understand **RAG**, **agents** and **MCP** by building each of them yourself, on your own laptop (macOS, Linux or Windows), with a free local model. The last module is a Slack assistant that uses all three.

---

## How this course works

- **Self-paced, in the terminal.** Each module folder has a `README.md` with the full lesson: the concepts (with the book chapter, for those who have it), the code to run, what to notice in the output, exercises where you change the code, and checkpoint questions. Reference answers sit next to each lesson in `checkpoint-answers.md`; write your own answers first.
- **From scratch first, then the real tool.** For each concept you first run a small hand-rolled version (about 50–100 lines), so nothing feels like magic. Then you switch to the standard library or tool.
- **Every module has the same shape:** Concepts → Build → Run → Exercises (you change the code) → Checkpoint questions. Before moving on, you should be able to answer the checkpoint questions in your own words.
- **Measured, not felt.** Every module ends with **reference results**: the author's numbers, measured on a 16 GB Intel laptop with no GPU, and what those numbers showed. Your numbers will differ, especially on a GPU. Compare the shape of the results, and check which findings hold on your machine.
- **Pace:** about 1–2 sessions of 2–3 hours per module. Commit at the end of each module.
- **Expect the small model to fail sometimes.** A 4B-parameter model on a laptop is much weaker than ChatGPT or Claude, and for learning that is a feature. You will see failures that big models hide, and you will learn the engineering (evaluation, retrieval, guardrails) that compensates for them.

### With an AI tutor (optional)

This course was written as a dialogue with an AI coding assistant ([Claude Code](https://claude.com/claude-code)) acting as the teacher: it explained each concept, wrote the code and handed over the commands, and the learner ran them and reported what happened. You can follow it the same way with Claude Code, with [Codex](https://developers.openai.com/codex) (OpenAI's coding agent), or with another coding assistant. Open the repo in it, point it at this file and the module's `README.md`, and ask it to act as the teacher: explain, review your checkpoint answers, and help when a run fails. Keep running the commands yourself, so that you see the output. Tip: in both Claude Code and Codex, a line starting with `!` runs a shell command from inside the session, so the output lands where the assistant can see it.

The only lesson that depends on which assistant you use is 7.3, where your MCP server is plugged into a real host. It gives the steps for both Claude Code and Codex.

## Why TypeScript (and where Python shows up)

The course is in **TypeScript on Node.js**. Building *applications* on top of models (prompting, RAG, agents, MCP, integrations) is fully supported in TypeScript. The official MCP SDK and the MCP Inspector are TypeScript, and Bolt for JavaScript is Slack's main SDK. The book makes the same point in chapter 1: AI engineering is moving closer to full-stack development.

Python is still where model *internals and training* live. In this course that's only the optional parts: Module 2 (done with Transformers.js instead) and the finetuning elective, where any Python is a ready-made script you run, not code you write.

The core lessons are plain scripts you run in the terminal, not Next.js. A web framework would put React, routing and server components between you and the concept you're learning. A Next.js chat UI is an elective at the end, once you know what goes on underneath it.

## The stack

| What | Choice | Why |
|---|---|---|
| Model runtime | [Ollama](https://ollama.com) | Installs in one step, runs quantized models (on the GPU on Apple Silicon or with an NVIDIA/AMD GPU on Linux and Windows, on the CPU otherwise), serves an HTTP API on `localhost:11434` |
| Chat model | **Qwen3 4B Instruct** (see below) | Free, open weights (Apache 2.0), good tool calling for its size |
| Embedding model | `nomic-embed-text` | Small (~270 MB), good quality, runs in Ollama |
| Language | TypeScript on Node.js 22.13+, run with `tsx` | No build step; `tsx file.ts` just runs it |
| LLM client | `openai` npm package pointed at Ollama | Ollama speaks the OpenAI-compatible API, so the same code runs against Hugging Face, Groq, etc. by changing one URL |
| Schemas and validation | Zod | Describes the shape of the JSON we want from the model |
| Vector store | plain arrays first, then sqlite-vec | Understand it, then use a real one. sqlite-vec runs inside SQLite, which is built into Node, and ships binaries for every platform the course supports (LanceDB no longer ships Intel Mac binaries) |
| MCP | Official TypeScript SDK (`@modelcontextprotocol/sdk`) + MCP Inspector | The reference implementation |
| Slack | `@slack/bolt` in Socket Mode | Needs no public URL, so it works from your laptop |
| Model internals (Module 2) | Transformers.js (`@huggingface/transformers`) | Hugging Face models in Node |
| Finetuning (elective) | Hugging Face `transformers` + `peft`, in one Python script run with [uv](https://docs.astral.sh/uv/) | Training lives in Python. uv installs the script's dependencies, and a suitable Python, without touching the rest of your system |

### Pick your model

Your memory decides what fits. On Apple Silicon the CPU and GPU share memory ("unified memory"), so count your RAM. On Linux or Windows with a discrete GPU, the GPU's memory decides what runs fast, and Ollama falls back to the CPU for whatever doesn't fit.

| Your RAM | Chat model | Download size |
|---|---|---|
| 8 GB | `llama3.2:3b` | ~2.0 GB |
| 16 GB or more | `qwen3:4b-instruct-2507-q4_K_M` ← course default | ~2.5 GB |
| *(Module 3)* | `qwen3:4b`: the *thinking* build of the same model | ~2.5 GB |

Qwen3 4B comes in two builds. **Instruct** answers directly. **Thinking** reasons step by step first, which is slower and sometimes better. On Ollama, plain `qwen3:4b` is the thinking build. The course starts with instruct and compares the two in Module 3.

**Without a GPU** (an Intel Mac, or a Linux or Windows machine with no NVIDIA or AMD GPU), Ollama runs models on the CPU. 16 GB is plenty of memory; the CPU is what limits speed. Pull both `qwen3:4b-instruct-2507-q4_K_M` and `llama3.2:3b`, measure them in lesson 1.3, and keep the Qwen model unless it's painfully slow. Long prompts are what's slowest on a CPU (RAG with many retrieved chunks, multi-step agents). If one experiment gets too slow, you can run just that one against a free hosted model by changing `LLM_BASE_URL`. The reference results in every module were measured on exactly this kind of machine: a 6-core Intel i7 laptop with 16 GB and no GPU. With a GPU, expect everything to be several times faster.

Ollama also lists newer models than these. Once you've built the eval harness (Module 3), testing one of them against Qwen3 is a good exercise: you'll judge it with numbers rather than hype. The model name lives in one place (`.env`), so switching is a one-line change.

## Accounts

| Account | Needed for | When |
|---|---|---|
| [Hugging Face](https://huggingface.co/join) (free) | Module 2 (under the hood), comparing your model against bigger hosted ones, the hosted-models elective. Calling hosted models needs an access token and pre-paid credit: a free account includes none, and the course uses about a cent | Before Module 2 |
| Slack: a **new free workspace** just for this course | Module 8 capstone | Before Module 8 |
| *Optional:* one hosted free tier (e.g. Groq or Google AI Studio) | A "local vs. frontier model" comparison | Any time |

Why a new Slack workspace: installing a custom app needs admin permission, which a work workspace may not grant. You also shouldn't pipe work data into experiments.

---

## Syllabus

### Module 0: Setup (half a session)

Instructions are [at the bottom of this file](#module-0-instructions).

---

### Module 1: Talking to a model → [`m01-basics/`](m01-basics/README.md)
*Book: ch. 1–2*

**Concepts**
- An LLM is a **stateless** function: text in, text out. Chat "memory" is your code resending the history every turn.
- Message roles (system / user / assistant) and chat templates.
- Tokens and the context window.
- Sampling: temperature and top-p, and why outputs vary between runs.
- Streaming, plus two latency metrics: time-to-first-token (TTFT) and tokens per second.

**Build**
1. `chat-raw.ts`: call Ollama with plain HTTP and see that it's just JSON.
2. `chat.ts`: a terminal chatbot with memory, using the `openai` SDK.
3. `sampling-lab.ts`: run the same prompt at different temperatures and measure TTFT and tokens per second.

**Exercises:** keep only the last N turns of history (basic context management); give the bot a persona with a system prompt.

**Checkpoint:** Why does the model "remember" the conversation? What happens when the history exceeds the context window? What does temperature change, mechanically?

---

### Module 2: Under the hood with Hugging Face (recommended, skippable) → [`m02-under-the-hood/`](m02-under-the-hood/README.md)
*Book: ch. 2*

**Concepts:** tokenization; logits → probabilities; sampling strategies; why small models hallucinate.

**Build:** load `Qwen3-0.6B` (same tokenizer as the course model) with Transformers.js, then:
- `tokens.ts`: print the tokens of a sentence;
- `next-token.ts`: show the top 10 next-token probabilities;
- `sampling.ts`: implement temperature, top-k and top-p yourself, checked by tests;
- `generate.ts`: generate text token by token with your own sampler.

**Exercises:** compare how prose, code and another language you speak get tokenized; find a prompt that makes greedy decoding loop.

**Checkpoint:** What is a logit? What does top-p do that temperature doesn't?

---

### Module 3: Prompting, structured output and evaluation → [`m03-prompting-evals/`](m03-prompting-evals/README.md)
*Book: ch. 2–5*

**Concepts**
- System prompts, few-shot examples, chain-of-thought.
- Instruct vs. thinking models (test-time compute): the two Qwen3 builds side by side.
- Structured output with JSON Schema (constrained decoding).
- Prompt injection basics.
- Evaluation: golden datasets, exact match, LLM-as-judge and its biases.

**Build**
1. `extract.ts`: pull structured data (a Zod schema) out of messy text, asked vs. schema-constrained.
2. `common/evals.ts` + `eval-tickets.ts`: a tiny eval harness, used to compare four prompt variants on 20 support tickets. Every later module reuses it.
3. `reasoning.ts`: instruct vs. chain-of-thought vs. the thinking build, scored on the same problems.
4. `judge.ts`: an LLM judge, tested for position and verbosity bias.

**Exercises:** improve a prompt and prove the improvement with an eval score, not by feel; run the same eval against the thinking build and against a bigger hosted model.

**Checkpoint:** Why is "it looked better" not an evaluation? When is LLM-as-judge appropriate, and when is it not?

---

### Module 4: Embeddings and semantic search → [`m04-embeddings/`](m04-embeddings/README.md)
*Book: ch. 6 (retrieval)*

**Concepts:** embeddings as vectors that capture meaning; cosine similarity; term-based retrieval (BM25) vs. embedding-based retrieval; query and document prefixes.

**Build**
1. `embed-lab.ts`: embed some sentences and print a similarity matrix.
2. `search.ts`: semantic search with plain arrays and a hand-written cosine function, next to BM25 keyword search.
3. `compare.ts`: measure both with hit@3 on 12 questions, using the Module 3 eval harness.
4. `hybrid.ts`: combine the two rankings with Reciprocal Rank Fusion (you write it, checked by tests).

**Corpus:** your course notes: `COURSE.md`, every module README, and your own Markdown in `data/notes/`, one chunk per section.

**Exercises:** find queries where BM25 beats embeddings, and queries where embeddings win.

**Checkpoint:** Why not just put every document in the prompt? What does it mean for two embeddings to be "close"?

---

### Module 5: RAG (retrieval-augmented generation) → [`m05-rag/`](m05-rag/README.md)
*Book: ch. 6*

**Concepts**
- The pipeline: ingest → chunk → embed → index → retrieve → augment the prompt → generate.
- Chunking strategies and sizes; top-k; hybrid search; reranking.
- Citing sources.
- Two different failure modes: a retrieval miss vs. a hallucinated answer.
- Evaluating retrieval (hit rate, recall@k) separately from answers (faithfulness).

**Build**
1. `chunk-eval.ts`: measure retrieval for four chunk sizes, and what each costs in prompt tokens.
2. `rag.ts`: RAG in about 100 lines on top of the Module 4 hybrid search, with citations and timing.
3. `rag-eval.ts`: 12 questions (two unanswerable), scored with a judge, each failure diagnosed as retrieval, generation or hallucination.
4. `vector-db.ts` (optional): the same index in sqlite-vec, searched in SQL.

**Exercises:** vary the chunk size and k, and measure the effect; make it say "I don't know" when retrieval is weak.

**Checkpoint:** Your RAG gives a wrong answer. How do you tell whether retrieval or generation failed?

---

### Module 6: Tool calling and agents → [`m06-agents/`](m06-agents/README.md)
*Book: ch. 6 (agents)*

**Concepts**
- An agent is a model + tools + a loop.
- Tool calling is just structured text that the model emits; **your code** executes the tool.
- ReAct: reason → act → observe.
- Planning and stopping conditions.
- Failure modes: wrong tool, bad arguments, infinite loops, errors that compound across steps.
- Safety: read actions vs. write actions, and human approval for risky ones.

**Build**
1. `react-from-text.ts`: a ReAct agent with **no** tool-calling API. It parses `Action: ...` lines out of plain text, which shows there's no magic.
2. `agent.ts`: the same agent with native tool calling (JSON Schema tool definitions, the loop, a step limit, and a trace printer that shows every step).
3. Tools: a calculator, the current time, reading files inside a sandbox folder, and `search_notes` (your Module 5 RAG). Together that's **agentic RAG**: the model decides when to search and what to search for.
4. A poisoned file: an email with a prompt injection, and the sandbox check in your code that stops it.
5. `agent-eval.ts`: both agents on tasks with checkable answers: score, model calls, errors, step limits and time.

**Exercises:** add a tool that writes files, gated behind a y/n confirmation; give it a task that needs 3+ steps and see where the small model breaks; run the same tasks against a bigger model.

**Checkpoint:** Who actually executes a tool, the model or your code? Why do agents compound errors?

---

### Module 7: MCP (Model Context Protocol) → [`m07-mcp/`](m07-mcp/README.md)
*Not in the book. MCP was announced in Nov 2024, around when the book went to print.*

**Concepts**
- The M×N integration problem that MCP solves.
- Roles: host, client, server.
- Primitives: tools, resources, prompts.
- Transports: stdio (local) and Streamable HTTP (remote).
- JSON-RPC under the hood; capability negotiation.
- Security: MCP servers run code on your machine, so think about trust and least privilege.

**Build**
1. `raw-server.ts`: an MCP server written by hand (JSON-RPC over stdin and stdout, no SDK), driven by piping in messages and then by the **MCP Inspector**.
2. `notes-server.ts`: your RAG as an MCP server built with the SDK, offering a `search_notes` tool, one resource per document and a prompt template. Inspect it and watch the raw JSON-RPC.
3. Plug it into **Claude Code** or **Codex** (`claude mcp add ...` / `codex mcp add ...`), so a real host uses your server.
4. `mcp-tools.ts` + `mcp-agent.ts`: your own MCP client. It connects to any MCP server, lists its tools and turns them into tool definitions for your Module 6 agent. Your local-model agent can then use **any** MCP server: yours, and off-the-shelf ones (the filesystem server).

**Exercises:** add a second server (your expenses in SQLite); serve the notes server over HTTP instead of stdio; use two servers at once; poison a tool description.

**Checkpoint:** What's the difference between an MCP tool and an MCP resource? Why is MCP a protocol rather than a library?

---

### Module 8: Capstone, a Slack study assistant → [`m08-slack/`](m08-slack/README.md)
*Book: ch. 10*

**Concepts:** the architecture of an AI application, layer by layer (context, guardrails, routing, caching, observability); Slack's Socket Mode; keeping the assistant independent of Slack; collecting user feedback, explicit and implicit.

**Build**
1. A Slack app created from a manifest, in Socket Mode, and `echo.ts`: the smallest bot, to check the setup.
2. `slack-server.ts`: an MCP server with Slack tools (read a channel, search messages, post a message), tried in the Inspector.
3. `assistant.ts` + `bot.ts`: when you @mention the bot, it runs your Module 6 agent (local model) with MCP tools from two servers (notes RAG + Slack), and replies in the thread with sources, behind input and output guardrails.
4. Observability: every run is logged to a JSONL file (prompt, tool calls, latency); 👍/👎 reactions are logged as user feedback; `report.ts` summarizes the logs and turns 👎 answers into eval cases for `eval.ts`.
5. Improve it, measured: six designs of the same assistant, each answering a failure the eval found in the one before (an agent with two prompts, search first, a router, read first, search again with HyDE), compared with `eval.ts --design`.

**Exercises:** index a Slack channel into your RAG; add a guardrail so the bot only posts in an allow-list of channels; a poisoned channel message; memory within a thread; a second search in code (query rewriting); a keyword router; a cache; a frozen Slack eval case.

**Checkpoint:** Draw the path from a Slack message to the bot's reply and name every component on it.

---

### Module 9: Electives (pick what interests you)

- **Web UI with Next.js** → [`m09-web/`](m09-web/README.md): put a chat page on your Module 8 assistant, which runs as its own service. It streams the answer word by word, and shows a live timeline of where the time goes, plus the route, tool calls and sources as they happen.
- **Frameworks** → [`m09-ai-sdk/`](m09-ai-sdk/README.md): rebuild your agent, MCP client and router with the Vercel AI SDK, run the same eval side by side with your own code, and judge what it actually buys you.

### Module 10: Electives on the model itself (pick what interests you)

Modules 1 to 9 take the model as it comes. These electives work on the model: adapt it to a task, make it run faster, or rent a bigger one. Each runs Module 3's ticket task with the eval harness, so their numbers compare directly with yours.

- **Finetuning** (ch. 7–8) → [`m10-finetune/`](m10-finetune/README.md): build a training set for Module 3's ticket task from AI-generated data (verified, deduplicated and decontaminated), then LoRA-finetune Qwen3-0.6B with a ready-made Python script (Hugging Face PEFT, run with uv) that uses an NVIDIA GPU, Apple Silicon's GPU or the CPU, or runs in Colab. Load the result into Ollama and compare it with prompting the same model and the 4B one. Then try to teach it facts, and compare that with RAG.
- **Inference optimization** (ch. 9) → [`m10-inference/`](m10-inference/README.md): measure what q4_K_M, q8_0 and fp16 do to size, memory, load time, prefill and decode speed, and to quality with the eval harness. Predict the KV cache from the model's shape and measure it at longer contexts, overfill the context, and trade one user's latency for everyone's throughput with parallel requests.
- **Hosted models** (ch. 4, 9–10) → [`m10-hosted/`](m10-hosted/README.md): run the same evals on hosted models through the Hugging Face router, the course model itself among them, and compare latency (median and worst), quality and cost from live prices. Then put retries, timeouts and a fallback model in front of a deliberately flaky provider.

---

## Repo layout

```
COURSE.md            ← you are here
README.md
package.json         ← dependencies (npm)
tsconfig.json
.env.example         ← copy to .env (gitignored) for settings and secrets
common/llm.ts        ← shared config: the one place to switch model or provider
common/evals.ts      ← the eval harness (Module 3 on)
m01-basics/          ← one folder per module, each with its own README.md lesson
m02-under-the-hood/
...
m09-*/               ← electives around the app: web, ai-sdk
m10-*/               ← electives on the model: finetune, inference, hosted
data/notes/          ← your own Markdown notes; the RAG corpus picks them up (Module 4 on)
.cache/              ← embeddings, downloaded models, indexes (gitignored)
```

## Suggested order

Modules 1 to 8 build on each other, so take them in order. Module 2 is optional but recommended. Modules 9 and 10 are menus: pick the electives that interest you, in any order.

---

## Module 0 instructions

The course runs on macOS (Apple Silicon or Intel), on Linux, and on Windows. Where a step differs, each one is given.

### On Windows: WSL2 or PowerShell

There are two ways to follow the course on Windows:
- **WSL2 (recommended).** WSL runs a real Ubuntu inside Windows. From then on you follow the **Linux** instructions, here and in every lesson, unchanged.
- **PowerShell.** Almost every command is the same, and where a lesson's command differs, the lesson gives a PowerShell version. The course hasn't been run end to end this way yet, so if something fails, WSL2 is the fallback.

**WSL2.** In PowerShell, run as administrator:

```powershell
wsl --install
```

Restart when it asks, open **Ubuntu** from the Start menu and create your Linux user. Then do everything in that Ubuntu terminal, following the Linux steps below:
- **Keep the repo in your Linux home folder** (`cd ~` before `git clone`), not under `/mnt/c/`. Windows files are much slower to read from WSL.
- **Install Ollama inside Ubuntu,** with the Linux command in step 3. With an NVIDIA GPU, keep the normal Windows driver and don't install a Linux one: WSL passes the GPU through. If the Windows Ollama app is also installed, quit it, so that only one Ollama answers on port 11434. If `systemctl` isn't available, start the server with `ollama serve` in a second terminal.
- **WSL gets half of your RAM by default,** and `free -h` shows only that share. On an 8 GB machine, give it more: create `%UserProfile%\.wslconfig` containing the two lines `[wsl2]` and `memory=6GB`, then run `wsl --shutdown` in PowerShell.
- **Pages the course serves on `localhost`** (the MCP Inspector in Module 7, the web UI in Module 9) open in your Windows browser. If a tool can't open the browser itself, copy the URL it prints.
- **If you use Claude Code or Codex as a tutor,** install and run it inside Ubuntu too.

**PowerShell.** Use PowerShell 7 (`winget install Microsoft.PowerShell`, then open "PowerShell 7" rather than "Windows PowerShell"): the course's PowerShell commands were checked with it. Then follow the Windows lines in the steps below.

### Step 1: Check your hardware

macOS:

```bash
system_profiler SPHardwareDataType | grep -E "Chip|Processor Name|Memory"
df -h ~ | tail -1
```

Linux:

```bash
lscpu | grep -E "Model name|^CPU\(s\)"
free -h | head -2
nvidia-smi --query-gpu=name,memory.total --format=csv   # only if you have an NVIDIA GPU
df -h ~ | tail -1
```

Windows (PowerShell, even if you'll use WSL2: inside WSL you'd only see WSL's share):

```powershell
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores
"{0:N0} GB of memory" -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Get-CimInstance Win32_VideoController | Select-Object Name
nvidia-smi --query-gpu=name,memory.total --format=csv   # only if you have an NVIDIA GPU
"{0:N0} GB free on C:" -f ((Get-Volume -DriveLetter C).SizeRemaining / 1GB)
```

This tells you whether you have Apple Silicon (M1/M2/M3/M4…), an Intel chip, or a GPU, plus your memory. Use the memory figure to pick your model in the table above. You need about 10 GB of free disk space for the whole course.

### Step 2: Node.js

The course needs Node.js **22.13 or newer** (any 24 or later is fine): it uses Node's built-in `.env` loader and its built-in SQLite, which earlier 22.x releases hide behind a flag.

```bash
node --version         # v22.13 or newer
```

- **macOS:** `brew install node`. [Homebrew](https://brew.sh) is the macOS package manager; if `brew --version` says "command not found", install it with the one-liner on brew.sh, then follow the "Next steps" it prints, which add brew to your PATH.
- **Linux and WSL2:** install [nvm](https://github.com/nvm-sh/nvm), then `nvm install 22`. Distro packages are often too old.
- **Windows (PowerShell):** `winget install OpenJS.NodeJS.LTS`, then open a new PowerShell window so that it finds `node`. If `npx` later fails with "running scripts is disabled on this system", allow scripts for your user once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Step 3: Ollama

- **macOS:** download the app from [ollama.com/download](https://ollama.com/download), move it to Applications and open it. A llama icon in the menu bar means the server is running. The app also installs the `ollama` command-line tool.
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`. It installs a systemd service, so the server starts on boot; `systemctl status ollama` shows whether it's running. Ollama uses an NVIDIA or AMD GPU automatically if the drivers are installed.
- **Windows (PowerShell):** download the installer from [ollama.com/download](https://ollama.com/download) and run it. Ollama then runs in the background, with an icon in the system tray, and the installer adds the `ollama` command. It uses an NVIDIA or AMD GPU automatically if the drivers are installed.

```bash
ollama --version
curl http://localhost:11434        # should print: Ollama is running
```

In PowerShell, write `curl.exe`: in Windows PowerShell, `curl` is a different command.

### Step 4: Download models and say hello

With 8 GB of RAM, use `llama3.2:3b` instead of the Qwen model. Without a GPU, pull both, and lesson 1.3 will tell you which one is fast enough.

```bash
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull llama3.2:3b              # 8 GB, or no GPU
ollama pull nomic-embed-text
ollama list
ollama run qwen3:4b-instruct-2507-q4_K_M "Explain what a token is in two sentences."
```

Then try an interactive chat:

```bash
ollama run qwen3:4b-instruct-2507-q4_K_M
```

Ask it a few things, and type `/bye` to exit.

**While a chat is open**, run this in a second terminal tab:

```bash
ollama ps
```

The `PROCESSOR` column should say `100% GPU` on Apple Silicon or with a supported GPU, and `100% CPU` otherwise (expected, just slower). `SIZE` shows how much memory the model uses.

### Step 5: Get the code

```bash
git clone <this repository> ai-engineering-course
cd ai-engineering-course
npm install
cp .env.example .env
```

These work in PowerShell too, where `cp` is short for `Copy-Item`. If `git` isn't found, install it with `winget install Git.Git` and open a new window.

Every module's Setup section names the packages it needs; `npm install` at the root installs all of them at once.

### Step 6: Accounts

- Create a free [Hugging Face](https://huggingface.co/join) account.
- The Slack workspace can wait until Module 8.
