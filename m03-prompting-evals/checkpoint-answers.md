# Module 3 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words). Question 5 depends on your own numbers from lesson 3.3, so it gives the reasoning and leaves the numbers to you. This file isn't part of the search corpus (only `README.md` is), so it doesn't change the Module 4 and 5 evals.

## 1. Why is "it looked better" not an evaluation? What does a real eval need?

Looking at one or two outputs tells you very little:
- **It isn't repeatable.**
- **It's biased towards what you expect to see.**
- **It can't show that a change fixed one case and broke three others.**

A real eval needs:
- **A fixed set of cases with expected answers,** including hard cases, and you keep adding to it.
- **A score function** that matches the output format you asked for.
- **Temperature 0,** so runs are repeatable.
- **No eval cases inside the prompt's examples** (contamination).
- **Comparing variants on the same set,** and reading the failures, not just the score.

Module 5 shows why. In the author's runs, three chunk sizes all scored 8/12 but failed in different ways, and the retrieval eval (lesson 5.1) favoured 400 characters while the end-to-end eval reversed that.

## 2. What's the difference between asking for JSON and constrained decoding? How does constrained decoding relate to the sampler you built in Module 2?

**Asking** ("reply in JSON") is an instruction. It makes JSON *likely*, but the model may still add a sentence or wrap the JSON in ``` fences.

**Constrained decoding** happens inside the sampler. The server turns the JSON Schema into a grammar, and at each step every token that would break it gets probability 0. The sampler then picks from what's left, the same way your `topK` filter works, except that a grammar decides which tokens survive. The output always parses.

## 3. Your structured output always parses. Can it still be wrong? How would you find out?

Yes. Validation checks the **shape, not the truth**. A valid `enum` value can still be the wrong category. A nullable field can be `null` when the information was in the text, or filled with something the text never said. Lesson 3.1's traps are exactly this: refund vs. swap, an unknown name that wasn't really unknown, and "smashed to bits" vs. `damaged`.

To find out, run an eval: labelled cases with the expected value of every field, compared field by field. Also read a sample of outputs yourself.

## 4. When is LLM-as-judge appropriate, and when isn't it? Name two biases and a counter-measure.

**It's appropriate** when there's no single right answer to match: summaries, tone, helpfulness, or "does this answer state the same key facts as the reference?" (your `rag-eval.ts` judge). It's also useful when there are more outputs than you can read.

**It isn't appropriate:**
- **When code can check the answer exactly:** categories, JSON fields, numbers.
- **When the judge is no stronger than the model it judges,** like a 4B model judging a 4B model.
- **For high-stakes calls,** unless you've compared the judge against human judgment.

**Biases and counter-measures:**
- **Position bias:** the judge prefers the first (or second) answer. Run both orders and count only verdicts that stay the same.
- **Verbosity bias:** it prefers the longer answer. Add a rubric that says "length is not quality".
- **Self-preference:** it prefers its own style. Use a judge from a different model family.

In every case, check the judge against your own verdicts on a sample.

A judge measures only what its prompt asks. In Module 5 you'll see a judge pass an answer containing an unsupported extra claim, because its rubric checks key facts, not faithfulness.

## 5. When is a thinking model worth its cost? Use your numbers from lesson 3.3.

It's worth it when the problem needs several steps (word problems, logic, planning) and a wrong answer costs more than waiting. It isn't worth it for lookups, classification or extraction.

The cost is decode tokens, the slowest phase on a CPU. At ~10 tokens/s, 500 reasoning tokens is ~50 s before the answer even starts. A thinking model can also run out of its token budget mid-thought and return an empty answer.

*Fill in your own numbers from lesson 3.3 (score, tokens out and time for `instruct`, `cot` and `thinking`) and decide for each problem whether the extra correct answers were worth the extra seconds.*

## 6. Why can't a better prompt fully fix prompt injection?

The model reads your instructions and the data as **one stream of tokens**, with no hard boundary between them. Delimiters like `<ticket>` are just more tokens. The model was trained to follow instructions wherever they appear. A better prompt makes it *less likely* to obey injected text, but never impossible, and an attacker can try as many phrasings as they like while you need to hold every time.

So you limit the damage instead:
- **Constrained output:** a classifier that can only output one of five categories can't leak anything.
- **Fewer powers:** give the model only the tools it needs.
- **A human confirms risky actions.**
- **Treat the model's output as untrusted.**

This matters more from Module 6 on, when models call tools. RAG has the same risk: retrieved documents are data in the prompt, so a note that contains instructions could steer your answers.
