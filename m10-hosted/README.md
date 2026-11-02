# Module 10 (elective): Hosted models

*Book: chapter 4 (choosing a model, build vs. buy), chapter 9 (latency and cost), chapter 10 (the model gateway)*

**Goal:** point the course at hosted models, and compare them with your local one on latency, quality and cost, with the same prompts and the same eval. Then handle what only a remote provider does to you: rate limits, errors and timeouts, with retries and a fallback model.

## Concepts (read before running anything)

1. **Same API, someone else's machine.** Hosted providers speak the same OpenAI-compatible API as Ollama, so a profile (`.env.<name>`, Module 3) switches the whole course by changing a URL, a key and a model name. What changes is everything around the request:
   - **where your data goes:** your prompts leave your machine, and the provider's terms decide what happens to them;
   - **who controls the model:** a name can start pointing at a new version, so an eval that passed last month may not pass today;
   - **latency:** a network round trip and a queue are added, while the GPUs on the other end are much faster than your laptop;
   - **cost:** you pay per token, instead of having bought the hardware;
   - **limits:** requests per minute, tokens per minute, and the occasional outage.

2. **The bill is tokens × price.** Providers charge per million input tokens and per million output tokens, and output usually costs several times as much. A reasoning model's thinking is output: you pay for tokens you never see (Module 3's test-time compute, with a price on it). Long prompts (RAG, agents, few-shot examples) make input the bigger part of the bill.

3. **Latency has parts.** Time to first token = network + queue + prefill. Then every further token takes the decode time. A big model on a fast GPU can write faster than your 4B on a CPU, but its first token can still come later. A hosted service varies from request to request, so measure several requests, and look at the worst one as well as the median (book ch. 9 uses percentiles: p50, p90, p99).

4. **The Hugging Face router** sits in front of many providers. `model:provider` picks who serves it (`openai/gpt-oss-120b:groq`). `:cheapest` and `:fastest` let the router pick, which means you don't know your price, and the same model name can be served by different hardware, at different precisions, with different limits from one request to the next. Its model list (`/v1/models`) publishes every provider's price, which `hosted.ts` reads.

5. **When the provider says no.** HTTP 429 means "too many requests" (you hit a rate limit, often with a `Retry-After` header). A 5xx means the provider failed. A timeout means you stopped waiting. A client can **retry**: wait, then try again, waiting longer each time (exponential backoff), with a random part (jitter) so that many clients don't all retry at the same moment. The `openai` SDK has been doing this for you since Module 1: two retries by default, on 408, 409, 429 and every 5xx, honouring `Retry-After`. Retries buy reliability with latency.

6. **A model gateway** (book ch. 10) is the one place your app sends every model request through. It applies the retry policy, falls back to a second model or provider when the first fails, enforces budgets and rate limits of its own, and logs every request. `common/llm.ts` has been a very small one: the single place that decides which model a request goes to.

7. **Local or hosted?** Neither wins everywhere:

   | | Local | Hosted |
   |---|---|---|
   | Data | stays on your machine | goes to the provider |
   | Cost | hardware you own, plus electricity | per token, nothing up front |
   | Quality | what fits in your memory | the biggest models there are |
   | Speed | your hardware's | a fast GPU, plus the network and a queue |
   | Control | you pick the version, it never changes | the provider can change or retire it |
   | Works offline | yes | no |

## Setup

You need a provider, a key and a little credit. The lessons use the **Hugging Face router**. When this elective was written (November 2026), a free Hugging Face account included no inference credit: buy pre-paid credit at [huggingface.co/settings/billing](https://huggingface.co/settings/billing), or use PRO, which includes $2 a month. At the router's prices, all of this elective's runs together come to about a cent. To pay nothing, use a free tier instead (see below). If you did Module 3's exercise 5, you already have `.env.hf`. Otherwise:
1. Create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens): fine-grained, with "Make calls to Inference Providers" ticked.
2. Create `.env.hf` in the repo root (gitignored, like every `.env.*` except `.env.example`):
   ```bash
   LLM_BASE_URL=https://router.huggingface.co/v1
   LLM_API_KEY=hf_...
   MODEL=openai/gpt-oss-120b:cheapest
   ```

`--models` overrides `MODEL`, so one profile covers several models. The lessons compare three:

| Model | Why |
|---|---|
| your local `qwen3:4b-instruct-2507-q4_K_M` | the baseline: your laptop |
| `Qwen/Qwen3-4B-Instruct-2507:nscale` | the **same model**, hosted: what changes is only the machine it runs on |
| `openai/gpt-oss-120b:groq` | a model with 30 times the weights, which reasons before it answers. It's a mixture of experts: each token uses about 5B of its 117B weights |

Another provider works the same way: a `.env.<name>` with its URL, key and model, then `--profile <name>`. Groq, Google AI Studio (Gemini's OpenAI-compatible endpoint) and OpenRouter all have free tiers, with rate limits. Groq and Google AI Studio don't serve Qwen3-4B, so with them you lose the same-model comparison. `priceOf()` only reads the Hugging Face router's price list, so add their prices to `prices.json`.

| File | What it is |
|---|---|
| `hosted.ts` | The models to compare, from a profile and `--models`, and their prices from the router's model list or `prices.json` |
| `latency.ts` | Lesson 10.9: time to first token, total time and tokens/s, several runs per model |
| `cost-eval.ts` | Lesson 10.10: Module 3's two tasks on every model, with the bill |
| `flaky.ts` | A proxy that plays a busy provider: 429s, a 503 and a slow response, on a fixed schedule |
| `gateway.ts` | Lesson 10.11: the same requests with no retries, the SDK's retries, and a gateway with a fallback |
| `prices.json` | Prices for providers that don't publish them, in dollars per million tokens |

Changes outside this folder:
- `m03-prompting-evals/tickets.ts` and `problems.ts` hold Module 3's tasks, so that this elective runs them unchanged;
- `common/evals.ts` records `tokensIn` with each output, which the bill needs, and widens the report's first column for long model names.

## Lesson 10.9: Latency (`latency.ts`)

```bash
npx tsx m10-hosted/latency.ts --profile hf --models Qwen/Qwen3-4B-Instruct-2507:nscale,openai/gpt-oss-120b:groq
```

The same 150-word answer, five times per model, streamed, after one warm-up request that isn't counted. About 3 minutes, most of it your local model. Each request starts with a different number ("Question 3: …"). Ollama reuses the previous prompt's cache for the part a new prompt shares with it, so the same prompt five times would barely be read at all (exercise 7).

**What to notice**
- **TTFT, median and worst.** Which model shows its first word soonest? How much does the worst run differ from the median, locally and hosted?
- **tok/s.** The same 4B model on your laptop and on a provider's GPU.
- **The reasoning tokens.** gpt-oss-120b thinks before it writes. How many tokens, and how much of its time to first word is thinking?
- **Total time.** For a short answer, which matters more: the first token or the speed after it?

## Lesson 10.10: Quality and cost (`cost-eval.ts`)

```bash
npx tsx m10-hosted/cost-eval.ts --profile hf --models Qwen/Qwen3-4B-Instruct-2507:nscale,openai/gpt-oss-120b:groq
```

Module 3's 20 tickets and six problems, on each model, with the same prompts. About 5 minutes.

**What to notice**
- **The same model, local and hosted.** Do they give the same answers? If not, nothing changed but where it ran: precision, sampling, template.
- **Which failures a much bigger model fixes,** and which it doesn't. Read them in the reports.
- **Tokens out.** Compare gpt-oss-120b's with the 4B's, on tickets that need one word. Where do the extra tokens go, and who pays for them?
- **Per 1,000.** What would a thousand tickets cost on each? Compare that with what your laptop costs to run for the same time (exercise 3).

## Lesson 10.11: When the provider says no (`gateway.ts`)

```bash
npx tsx m10-hosted/gateway.ts
```

It needs no key: the proxy sits in front of your local Ollama, so the failures are fake and the answers are real. Eight tickets go through it three ways. About a minute.

**What to notice**
- **`no retries`:** which tickets fail, and with what error.
- **`SDK retries`:** how many failures the SDK's two retries turn into answers, and what each one cost in time. Find the 1-second waits that come from `Retry-After`, and the 10-second one that comes from the timeout.
- **`gateway`:** every ticket answered, some by the fallback. What did its slowest ticket take, compared with the SDK's?
- **The `proxy:` column.** After a timeout, the SDK sent the request again. The proxy still forwarded the one it was holding, 12 seconds in, although nobody was waiting for it any more. On a real provider, both may run, and both may be billed.

With a key, put the proxy in front of a hosted model, with your local model as the fallback: `--profile hf`.

## Exercises

1. **Providers for one model.** Run `latency.ts` on `openai/gpt-oss-120b` with three providers from the router's list (`:groq`, `:cerebras`, `:novita`, …). Same weights: how much do latency and price differ? Then run `cost-eval.ts` on two of them: do the answers differ too?
2. **Pick a model with numbers.** Find the cheapest hosted model that scores 20/20 on the tickets. Use the router's model list (`curl https://router.huggingface.co/v1/models`) to choose candidates.
3. **Break-even.** Your laptop draws more power while it generates: estimate how much (a plug-in power meter, or your laptop's specification), and work out the electricity cost of 1,000 tickets from lesson 10.10's time per ticket. At which volume does the hosted 4B cost less than your electricity? What else should go into the comparison?
4. **A budget.** Add a spending limit to `gateway.ts`: count each answer's tokens, price them with `priceOf()`, and send everything to the fallback once the limit is reached.
5. **Your own schedule.** Edit `SCHEDULE` in `flaky.ts`: three 429s in a row, or every request slow. When does the SDK give up, and when does the gateway's fallback start to carry the whole load? What should a gateway do then (book ch. 10: a circuit breaker)?
6. **A hosted model in the capstone.** Run `m08-slack/eval.ts` with `--profile hf`. Which of Module 8's six designs still matter with a much bigger model?
7. **The prompt cache.** In `latency.ts`, send `PROMPT` instead of `question(n)`, and run it without `--profile`, on your local model only. What happens to TTFT? Which requests in a chat app share most of their prompt with the one before?

## Checkpoint (answer in your own words)

1. What stays the same, and what changes, when you move from Ollama to a hosted provider through the same API?
2. How is a request's price calculated? Why can a reasoning model cost much more on a task that needs a one-word answer?
3. Why measure a hosted model's latency several times? What do the median and the worst run each tell you?
4. The same 4B model ran locally and hosted. What could make their answers differ?
5. What does the SDK do on a 429, a 503 and a timeout, by default? When is retrying the wrong thing to do?
6. What does a model gateway add, and which of its jobs did `common/llm.ts` already do?
7. For your own use, would you choose local or hosted? Defend it with your numbers.

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results

The author's numbers, from a 6-core Intel i7 laptop with 16 GB and no GPU, `qwen3:4b-instruct-2507-q4_K_M` behind the proxy.

**Lessons 10.9 and 10.10 haven't been measured on the reference laptop yet.** They need Hugging Face credit (see Setup), and their reference results will be added here.

| Measurement | Value |
|---|---|
| 10.11, no retries | 4/8 answered: two 429s, a 503 and a 10-second timeout became errors. 12.8 s in all |
| 10.11, SDK retries | 8/8 answered, in 30.7 s. A pair of 429s cost 2.6 s (two 1-second `Retry-After` waits), a 503 about 0.5 s of backoff, and each slow request 11 s: the full 10-second timeout, then the retry |
| 10.11, gateway | 8/8 answered, 3 of them by the fallback, in 11.0 s. The slowest ticket took 5.7 s (the 5-second timeout, then the local model) |
| 10.11, the run | about a minute |

**What these runs showed**
- **The SDK's defaults are reliable and slow.** Two retries turned every failure into an answer, with every category right, but the two slow requests each cost the full 10-second timeout before the retry: the SDK's default timeout is 10 minutes, so without one of your own, a request that hangs keeps a user waiting for ten minutes.
- **A gateway trades who answers for when.** Giving up after 5 seconds, or on a 503 with no hint, and falling back answered everything in a third of the SDK's time, with no ticket over 6 seconds. Here the fallback was the same model, so nothing was lost; with a smaller fallback model, part of the answers would be worse, and the gateway should log which ones.
- **Retry-After is cheap to honour.** The 429s cost a second each, because the "provider" said exactly how long to wait.

## Troubleshooting

| Problem | Fix |
|---|---|
| `ENOENT … .env.hf` | Create the file (see Setup) |
| `401` / `Invalid credentials` | The token is wrong, or it lacks "Make calls to Inference Providers". Create a new one |
| `402` / `You have no remaining credits` | The account has no inference credit: a free account has none, and PRO's monthly credit can run out. Buy pre-paid credit (see Setup) |
| `400` … `model not supported by provider` | That provider doesn't serve the model (any more). Pick another from `curl https://router.huggingface.co/v1/models` |
| A price shows as `unknown` or `?` | The provider isn't pinned (`:cheapest`), or doesn't publish prices: add it to `prices.json` |
| A hosted run fails with `429` | That's a real rate limit. Wait a minute, or lower `--runs` |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
