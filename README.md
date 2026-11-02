# AI Engineering: a hands-on course

A hands-on course on building with language models. You learn **RAG**, **agents** and **MCP** by writing each one from scratch in TypeScript, running it against a free model on your own laptop, and measuring it. The capstone is a Slack study assistant that uses all three.

It was written as a companion to [*AI Engineering*](https://www.oreilly.com/library/view/ai-engineering/9781098166298/) by Chip Huyen (O'Reilly, 2025), which has no official hands-on companion, and it grew out of one reader working through the book module by module with an AI coding assistant as tutor. **The book is not required.** Every lesson explains the concepts it needs before you run anything, and the chapter references are there for readers who want to go deeper, not as homework.

- **The full course plan, the setup instructions and the syllabus:** [COURSE.md](COURSE.md)
- **Each module's lesson:** the `README.md` in its folder, starting with [`m01-basics/`](m01-basics/README.md)

## Who it's for

- Anyone curious about how RAG, agents and MCP work underneath, who would rather build small versions than read about them: application developers, people moving into AI engineering, or readers of the book who want to make it concrete.
- You can program and are comfortable in a terminal. Everything is TypeScript on Node.js; no Python is needed, and no prior AI experience is assumed.
- You have a Mac (Apple Silicon or Intel), a Linux machine or a Windows PC (through WSL2, or in PowerShell), with 16 GB of memory (8 GB works with a smaller model) and about 10 GB of free disk. A GPU is not required; the reference numbers in the course come from a 16 GB Intel laptop without one.

## What you build

| Module | You build | Book |
|---|---|---|
| 1 | A chatbot from raw HTTP up, with memory, sampling and latency measurements | ch. 1–2 |
| 2 *(optional)* | Your own tokenizer walk-through and sampler (temperature, top-k, top-p) on a 0.6B model | ch. 2 |
| 3 | Structured output, an eval harness, instruct vs. thinking models, an LLM judge and its biases | ch. 2–5 |
| 4 | Embeddings, cosine search, BM25 and hybrid search with Reciprocal Rank Fusion, measured with hit@k | ch. 6 |
| 5 | RAG over your own notes, with chunking experiments, citations and a retrieval-vs-generation diagnosis | ch. 6 |
| 6 | A ReAct agent from plain text, then native tool calling, agentic RAG, a prompt-injection trap and an agent eval | ch. 6 |
| 7 | An MCP server by hand, one with the SDK, Claude Code or Codex as a host, and your own MCP client | not in the book |
| 8 | A Slack study assistant: MCP tools, guardrails, logs, user feedback, and six measured designs | ch. 10 |
| 9 *(electives)* | A streaming Next.js UI; the same agent rebuilt on the Vercel AI SDK and compared with your own code | |

Every module has the same shape: concepts (with the book chapter), code to run, what to notice, exercises where you change the code, checkpoint questions with reference answers, and the author's reference results so you can compare your numbers.

## Quick start

Full setup for macOS, Linux and Windows is in [COURSE.md, Module 0](COURSE.md#module-0-instructions). In short (the same in PowerShell):

```bash
# Node.js 22.13+ and Ollama installed (see Module 0)
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull nomic-embed-text
npm install
cp .env.example .env
npx tsx m01-basics/chat.ts
```

## Stack

TypeScript on Node.js, [Ollama](https://ollama.com) running Qwen3 4B locally, the `openai` SDK talking to Ollama's OpenAI-compatible API, Zod, sqlite-vec, the official MCP TypeScript SDK, and Slack's Bolt in Socket Mode. Nothing needs a paid account; one optional lesson compares your local model with a hosted one.

## Layout

| Path | What's in it |
|---|---|
| `COURSE.md` | The course plan: how it works, the stack, model choice, setup, syllabus |
| `common/` | Shared code. `llm.ts` is the one place that decides which model and provider to use; `evals.ts` is the eval harness |
| `m01-basics/` … `m09-web/` | One folder per module. Its `README.md` is the lesson, `checkpoint-answers.md` the reference answers |
| `data/notes/` | Your own Markdown notes; the RAG modules index them with the course text |
| `.env.example` | Settings template; copy it to `.env` (gitignored) |
| `docs/initial-prompt.md` | The prompt that started the course |

## Following it with an AI tutor (optional)

The course was written as a dialogue with [Claude Code](https://claude.com/claude-code) as the teacher, and it works well that way (but not necessary) with Claude Code, [Codex](https://developers.openai.com/codex) or another coding assistant: open the repo in it, point it at `COURSE.md` and the module's `README.md`, and ask it to teach, review your checkpoint answers and help when a run fails, while you run the commands yourself. The one lesson that uses the assistant as an MCP host (7.3) has steps for both Claude Code and Codex. See "With an AI tutor" in [COURSE.md](COURSE.md#with-an-ai-tutor-optional).

## License

[MIT](LICENSE). The book itself is by Chip Huyen and O'Reilly; this course refers to its chapters and quotes nothing from it.
