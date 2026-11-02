# Module 1: Talking to a model

*Book: chapters 1–2 (and the prefill/decode part of chapter 9)*

**Goal:** see exactly what happens when you "chat" with an LLM: what gets sent, what comes back, and why the answers vary.

## Concepts (read before running anything)

1. **The model is stateless.** Every request is independent; the model has no memory of the last one. When a chatbot "remembers", it's because the app resends the whole conversation every time. You'll prove this in lesson 1.2.

2. **Messages and roles.** A chat is a list of messages, each with a role:
   - `system`: instructions about how to behave (persona, rules, format);
   - `user`: what the person says;
   - `assistant`: what the model said before.

   The model never actually sees JSON. Ollama flattens the list into one long string with special marker tokens (for Qwen, things like `<|im_start|>user`), and the model simply continues that text. That layout is the **chat template**.

3. **Tokens.** Models read and write *tokens*: word pieces, roughly 4 characters of English each. Speed, cost and limits are all measured in tokens. The **context window** is the most tokens a single request can hold (input + output). Ollama often uses a smaller window than the model's maximum to save memory; that will matter in Module 5.

4. **Sampling.** For each step the model outputs a probability for *every* token in its vocabulary, and a *sampler* picks one. **Temperature** reshapes those probabilities: at 0 the sampler always picks the most likely token (so outputs repeat), and higher values flatten the distribution (more variety, and eventually nonsense).

5. **Two phases, two latency numbers.**
   - **Prefill:** the model reads your whole prompt in one parallel pass. This decides the **time to first token (TTFT)**.
   - **Decode:** the model generates the answer one token at a time. This decides the **tokens per second**.

## Setup (once)

```bash
node --version                 # needs v22.13 or newer (Module 0 in COURSE.md)
ollama pull qwen3:4b-instruct-2507-q4_K_M
npm install openai
npm install -D typescript tsx @types/node
cp .env.example .env
```

With 8 GB of RAM, pull `llama3.2:3b` instead and set `MODEL=llama3.2:3b` in `.env`.

`tsx` runs TypeScript files directly, so there's no build step. `npm run typecheck` checks the types in all files whenever you want.

## Lesson 1.1: Raw HTTP (`chat-raw.ts`)

```bash
npx tsx m01-basics/chat-raw.ts "Why is the sky blue?"
```

**What to notice**
- The request is a small JSON object: a model name and a list of messages. That's all an LLM API is.
- **Input tokens** is bigger than your question. It also counts the system prompt and the chat-template markers.
- Run it twice. The first run's **loading the model** time is large (a cold start); the second is ~0, because the model stays in memory for a few minutes.

## Lesson 1.2: A chatbot with memory (`chat.ts`)

```bash
npx tsx m01-basics/chat.ts
```

Try this conversation:
1. `My name is Alex and I love climbing.`
2. `What's a good weekend plan for me?`
3. `What's my name?`
4. `/history`: the conversation as the app stores it. On the last turn, all of it except the bot's final reply was sent.

Watch the grey `[sent N messages (~X tokens)]` line grow every turn.

Then quit (`/exit`) and repeat the same conversation with memory off:

```bash
npx tsx m01-basics/chat.ts --no-memory
```

**What to notice:** with memory off the model has no idea who you are, even though the program still stores the history. Remembering is the app's job, not the model's.

## Lesson 1.3: Sampling and speed (`sampling-lab.ts`)

```bash
npx tsx m01-basics/sampling-lab.ts
```

**What to notice**
- At temperature 0 you should get one distinct answer, repeated. At 0.7 you should get variety, and at 1.5 possibly weird ones.
- Note your **TTFT** and **tokens/s**: those are your machine's numbers for this model. People read at roughly 5–8 tokens/s, so anything well above that feels "instant" when streamed.

**Compare two models.** Putting `MODEL=...` before a command overrides `.env` for that one run:

```bash
MODEL=llama3.2:3b npx tsx m01-basics/sampling-lab.ts
```

In PowerShell, set the variable, run, then remove it, so that later runs use `.env` again:

```powershell
$env:MODEL = "llama3.2:3b"; npx tsx m01-basics/sampling-lab.ts; Remove-Item Env:MODEL
```

The smaller model should generate faster. Generating each token means reading *all* of the model's weights from memory once, so decode speed is roughly memory bandwidth ÷ model size. That's why decode is called *memory-bound* (book ch. 9), and why quantized (smaller) models are faster. Without a GPU, use these numbers to pick your model: keep Qwen unless its tokens/s feels painfully slow.

## Exercises (you write the code)

1. **Short-term memory.** In `chat.ts`, find `EXERCISE 1`. Send the system prompt plus only the **last 4 messages**. Then tell the bot your name, chat for 3 more turns and ask your name again.
   *Hint: arrays have `.slice()`, and a negative start counts from the end.*
2. **Persona.** Change `SYSTEM_PROMPT` in `chat.ts` so the bot is a grumpy librarian who answers in at most one sentence. How well does a 4B model stick to the persona over several turns?
3. **Top-p.** In `sampling-lab.ts`, add `top_p: 0.5` to the request and rerun. Does it tame temperature 1.5? (We implement both from scratch in Module 2.)
4. **Cold start.** Run `ollama stop qwen3:4b-instruct-2507-q4_K_M`, then run `chat-raw.ts` twice and compare the load times.
5. **Look inside your model:**
   ```bash
   ollama show qwen3:4b-instruct-2507-q4_K_M
   ollama show qwen3:4b-instruct-2507-q4_K_M --template
   ```
   Find the parameter count, the context length and the quantization (e.g. `Q4_K_M` means about 4 bits per weight instead of 16; book chapter 9). In the template, find where the `system`, `user` and `assistant` messages go.

## Checkpoint (answer in your own words)

1. Why does the chatbot "remember" your name, and what did `--no-memory` prove?
2. What will eventually happen if a conversation keeps growing? What could an app do about it?
3. Why is "input tokens" larger than the number of words in your question?
4. What does temperature change, mechanically? When would you want 0, and when 0.8?
5. Which phase (prefill or decode) dominates TTFT, and which dominates the total time for a long answer?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (Intel i7 laptop, 16 GB, CPU only, `qwen3:4b-instruct-2507-q4_K_M`)

The author's numbers, from a 6-core Intel i7 laptop with 16 GB and no GPU. Yours will differ, so compare the shape, not the digits: on a GPU, expect several times the speed.

| Measurement | Value |
|---|---|
| Time to first token, short prompt | ~0.4 s |
| Generation speed, short prompt | ~10 tokens/s |
| Prefill speed, long prompt | ~47 tokens/s (1,830 tokens in 38.8 s) |
| Generation speed with a 1,830-token prompt | ~6.6 tokens/s |
| Cold start (loading the model) | ~6 s |
| Same long prompt again (prompt cache) | 1,829 of 1,830 tokens reused; reading the input went from 38.8 s to 0.15 s |
| Tokens per English word | ~1.3 (160 tokens for 126 words) |

**What these runs showed**
- **Stored ≠ sent.** The app keeps the whole conversation, but the model only sees what's in each request. A last-4-messages window starts with an assistant message, and the model ignored the "Hi Ben!" that was still in it.
- **`top_p` filters, temperature reshapes.** With `top_p: 0.5`, every temperature gave "Mocha Haven": only one candidate survived each step, so temperature had nothing to choose between.
- **Small models can't count words.** They see tokens, not words, so "about 150 words" gave 126–140. Enforce lengths with `max_tokens`.
- **"Compatible" ≠ identical.** Ollama 0.40.5 silently ignores `max_completion_tokens`, so use `max_tokens`. A test only proves something if it could fail: the cap has to be below the answer's natural length.
- **Long prompts are expensive on a CPU.** With a long prompt and a short answer, prefill dominates: about 45 s before the first word on this laptop. Keep RAG prompts lean.
- **Prompt caching** reuses work only up to the **first difference** from the previous prompt. Put the parts that stay the same first (system prompt, instructions, documents) and the parts that change last (the question).

## Troubleshooting

| Error | Fix |
|---|---|
| `Could not reach Ollama` / `Connection error` | macOS: open the Ollama app (llama icon in the menu bar). Linux: `systemctl start ollama`. Windows: start Ollama from the Start menu (its icon sits in the system tray). On any of them: `ollama serve` in another tab |
| `model "..." not found` | Run `ollama pull <model>`, or fix `MODEL` in `.env` (`ollama list` shows what you have) |
| `process.loadEnvFile is not a function` | Your Node is too old: install Node 22.13 or newer (Module 0 in `COURSE.md`) |
| `Cannot find package 'openai'` | Run the `npm install` commands from Setup, from the repo root |
