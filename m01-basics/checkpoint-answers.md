# Module 1 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the numbers from [Reference results](README.md#reference-results-intel-i7-laptop-16-gb-cpu-only-qwen34b-instruct-2507-q4_k_m). This file isn't part of the search corpus (only `README.md` is), so it doesn't change the Module 4 and 5 evals.

## 1. Why does the chatbot "remember" your name, and what did `--no-memory` prove?

The model remembers nothing. Every request is independent. `chat.ts` keeps the conversation in an array and **resends all of it on every turn**, so the model reads your name again each time.

With `--no-memory`, the app still stored the history but sent only your latest message, and the model had no idea who you were. So remembering is the app's job, not the model's: **what's stored isn't what's sent.** Exercise 1 made the same point from the other side. In a last-4-messages window, the name was still there in an assistant message ("Hi Ben!"), and the model ignored it anyway.

## 2. What will eventually happen if a conversation keeps growing? What could an app do about it?

Every turn resends the whole history, so the input grows every turn:
- **It gets slower.** All of it is prefill. On the reference laptop (CPU only), a 1,830-token prompt took 38.8 s before the first word.
- **It costs more** on a paid API, where you pay per input token.
- **Eventually it exceeds the context window.** Then the request fails, or the oldest part gets cut off silently, sometimes including the instructions.

What an app can do:
- **Keep a window:** the system prompt plus the last N messages (exercise 1).
- **Summarize older turns** into a short running summary.
- **Store key facts** (the user's name, preferences) separately and put them back into the prompt.
- **Retrieve only the old messages relevant to the current question** (RAG over the history, Module 5).

Prompt caching makes the unchanged beginning of the prompt cheap to reread, but it doesn't make the window any bigger.

## 3. Why is "input tokens" larger than the number of words in your question?

- **Tokens are word pieces, not words.** You measured about 1.3 tokens per English word (160 tokens for 126 words). Rare words, numbers and symbols split into more pieces.
- **The count includes everything sent:** the system prompt and the chat-template markers (`<|im_start|>user` and so on) that Ollama wraps around every message.

## 4. What does temperature change, mechanically? When would you want 0, and when 0.8?

The model's output stays the same, and so does the set of possible next tokens. Temperature only reshapes the probabilities the sampler picks from. Mechanically, it divides the logits before softmax (Module 2):
- **Below 1** it sharpens them, so the top token dominates. **At 0** the sampler always takes the top token, which is greedy, so the same prompt gives the same output.
- **Above 1** it flattens them, so long shots get picked: more variety, and at 1.5 some nonsense.

When to use which:
- **Use 0 when you want repeatable answers:** evals, extraction, classification, RAG answers. Your `rag-eval.ts` runs at 0.
- **Use ~0.8 when you want variety:** brainstorming, names (the coffee shops), different phrasings.

Keep in mind your top-p finding: **top_p filters, temperature reshapes.** With `top_p: 0.5`, only one candidate survived each step, so every temperature gave "Mocha Haven".

## 5. Which phase dominates TTFT, and which dominates the total time for a long answer?

- **Prefill dominates TTFT.** The model has to read the whole prompt before it writes anything. A short prompt took ~0.4 s, and 1,830 tokens took 38.8 s.
- **Decode dominates long answers.** It generates one token at a time, at ~10 tokens/s on a short prompt and ~6.6 tokens/s with a long one. 500 tokens is about a minute.

Decode is *memory-bound*: every token reads all of the model's weights once, which is why smaller or quantized models decode faster. On a CPU, RAG (long prompt, short answer) is mostly prefill, and agents that think out loud are mostly decode.
