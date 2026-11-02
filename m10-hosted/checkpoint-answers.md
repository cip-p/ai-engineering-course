# Module 10 (hosted models) checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the runs in [Reference results](README.md#reference-results). This file isn't part of the search corpus (only `README.md` is), so it can quote the cases.

## 1. What stays the same, and what changes, when you move from Ollama to a hosted provider through the same API?

**The same:** the request and the response. The same `messages`, the same `temperature`, the same `tools` and `response_format`, the same `usage` counts coming back. Every script in the course runs unchanged, with a different URL, key and model name.

**What changes:**
- **Where the data goes.** Every prompt (tickets, notes, Slack messages) now leaves your machine, under the provider's terms.
- **Who controls the model.** The provider can update it, quantize it, or retire it under the same name.
- **Latency.** A network round trip and a queue are added, and they vary. The hardware is much faster.
- **Cost.** You pay for every token, input and output, instead of having bought the hardware.
- **Limits and failures.** Rate limits, quotas, outages and timeouts: things your laptop never did to you.
- **Features.** "Compatible" isn't identical: one provider supports `json_schema`, another doesn't; context lengths differ. The router's model list says what each provider supports.

## 2. How is a request's price calculated? Why can a reasoning model cost much more on a task that needs a one-word answer?

**Price = input tokens × input price + output tokens × output price,** with prices per million tokens. Output usually costs several times as much as input.

A reasoning model writes its thinking first, and **its thinking is output**: billed at the output price even though you never see it. For a one-word ticket category, the visible answer is a token or two, but the thinking can be dozens or hundreds, so the bill is set by the thinking, not by the answer.

Lesson 10.10's tokens-out column shows it for your models: compare a reasoning model's tokens out on the tickets with the one or two tokens a direct answer needs. Some providers report the thinking separately (`completion_tokens_details.reasoning_tokens`), but they all bill it.

## 3. Why measure a hosted model's latency several times? What do the median and the worst run each tell you?

A hosted request's latency is your request plus everyone else's: the network, the provider's queue, which machine it lands on, and whether that machine is busy. One measurement is an anecdote.

- **The median** is the typical experience: what most of your users see most of the time.
- **The worst run** (with more runs, a high percentile like p90 or p99) is what some users see every day. In an app that makes several model calls per answer, like an agent, the slowest call often sets the total.

Lesson 10.9 prints both. Locally the runs vary too (heat, other apps: the inference elective), but a hosted model adds variation you can't see or control.

## 4. The same 4B model ran locally and hosted. What could make their answers differ?

"The same model" means the same released weights, but not the same computation:
- **Precision.** Locally it's `q4_K_M`; a provider usually serves 16-bit weights (or its own quantization). The inference elective showed that even q8_0 changes some answers.
- **The software.** llama.cpp locally, vLLM or a provider's own engine there: different kernels add up numbers in a different order, and floating-point results differ in the last digits.
- **Sampling defaults.** Temperature 0 is greedy almost everywhere, but other defaults (top-p, repetition penalties, seeds) can differ.
- **The template.** How the provider turns `messages` into tokens: system prompt handling, the thinking block.
- **Batching.** On a busy GPU, your request is computed together with others, and on some engines that changes the numbers slightly too.

Lesson 10.10 shows whether this happens with your provider: compare the local and the hosted 4B's answers, case by case, as the inference elective compared quantizations.

## 5. What does the SDK do on a 429, a 503 and a timeout, by default? When is retrying the wrong thing to do?

By default the `openai` SDK retries **twice** on 408, 409, 429 and every 5xx, and on connection errors and timeouts:
- **429:** it waits as long as `Retry-After` (or `retry-after-ms`) says, up to 60 seconds;
- **503 without a hint:** exponential backoff from 0.5 s, doubling each time up to 8 s, minus up to 25% jitter;
- **A timeout** (10 minutes by default!) counts as a connection error and is retried the same way.

Retrying is the wrong thing to do:
- **When the request isn't the problem:** a 400 (bad request) or 401 (bad key) will fail again, which is why the SDK doesn't retry them;
- **When someone is waiting:** three attempts with long timeouts can take minutes. Better to fail fast and fall back;
- **When the request has side effects:** a timed-out request may still have run. Retrying a "send the message" or "charge the card" tool can do it twice, unless the operation is idempotent;
- **When the provider is overloaded:** every client retrying makes it worse. Back off, and stop retrying for a while (a circuit breaker);
- **When you're paying:** an abandoned request may still be billed, and so is its retry.

In the author's run of lesson 10.11, the SDK's two retries turned all eight tickets into answers, but each request held by the proxy cost the full 10-second timeout before its retry: 30.7 s for eight tickets. The gateway, which gave up after 5 seconds or on a 503 with no hint and fell back, answered all eight in 11.0 s, none taking over 6 s.

## 6. What does a model gateway add, and which of its jobs did `common/llm.ts` already do?

A gateway is the one place every model request goes through, so that what applies to all of them is written once:
- **Routing:** which provider and model each request goes to;
- **Retries, timeouts and fallbacks:** lesson 10.11's policy;
- **Keys and access control:** apps never see the provider's keys;
- **Budgets and rate limits of your own:** per user, per team, per app;
- **Logging and cost tracking:** every request, its tokens and its price;
- **Caching:** the same request answered once (Module 8's exercise).

`common/llm.ts` already did the first job: it's the single place that decides the URL, key and model, so a profile switches the whole course. Module 8's logs did the logging for one app. Lesson 10.11's `gateway()` added a retry policy and a fallback. A production gateway (LiteLLM, Portkey, a cloud provider's) does all of it, as a separate service.

## 7. For your own use, would you choose local or hosted? Defend it with your numbers.

There's no single right answer: it's a decision for a use, made with numbers. A way to work through it:
- **Is the data allowed to leave the machine?** If not, it's local, or a provider with a contract that covers it, and the rest is detail.
- **Is the local model good enough?** On the course's tasks, the local 4B scored 20/20 on the tickets but failed parts of Modules 6 and 8. If your task needs a bigger model, local isn't an option on a laptop.
- **What does it cost at your volume?** Price 1,000 requests from lesson 10.10, and compare that with what your hardware costs, including its time: a request that takes a second hosted and ten locally costs you time on every request.
- **How much latency can you take, and how much variation?** Lesson 10.9's medians and worst runs.
- **What happens when it's down?** Local doesn't depend on a network or a provider. Hosted needs a fallback (lesson 10.11).

A common answer: local for private data, experiments and anything that runs offline; hosted, behind a gateway with a local fallback, when quality or speed matter more than data leaving the machine. Back yours with your lesson 10.9 and 10.10 numbers.
