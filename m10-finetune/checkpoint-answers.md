# Module 10 (finetuning) checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the runs in [Reference results](README.md#reference-results-intel-i7-laptop-16-gb-cpu-only). This file isn't part of the search corpus (only `README.md` is), so it can quote the cases.

## 1. When would you finetune instead of writing a better prompt? When would you use RAG instead of finetuning?

**Prompt first,** always: it's the cheapest change, you can test it in minutes, and it's easy to undo. Finetune when the prompt has stopped paying:
- **A narrow task done very often,** where a small finetuned model can replace a big prompted one, and saves on every request (latency, cost, memory);
- **A long prompt that never changes:** instructions and examples paid for on every call can move into the weights (lesson 10.3's tokens-in table);
- **A format or style the model won't hold** however you ask;
- **Data you can't send to a bigger model,** so the small model has to get good on its own.

**RAG instead of finetuning** whenever the problem is *knowledge*: facts the model doesn't have, facts that change, and facts you need to cite. Retrieval updates the moment the document does, shows its source, and can say "I don't know" when nothing matched. Finetuning does none of that (question 6).

They combine: finetune for the format and the behaviour, retrieve for the facts.

## 2. What does LoRA train, and why does it need so much less memory than full finetuning?

LoRA freezes every original weight. Next to each chosen matrix *W* (out × in) it adds two small ones, *A* (rank × in) and *B* (out × rank), and the layer computes *W·x + B·A·x*. Only *A* and *B* learn. *B* starts at zero, so training begins from exactly the base model.

The memory saving comes from what full finetuning has to keep **for every trained weight**: the weight, its gradient, and the optimizer's two running averages (Adam), each in 32 bits. For 600M weights that's about 10 GB, before any activations. LoRA keeps those four numbers only for its 1.7% of the weights. The frozen ones still sit in memory and still take part in the forward and backward passes, but they have no gradients and no optimizer state.

Two more gains: the adapter is a small file (tens of MB), and one base model can carry many adapters, one per task. Merging folds *B·A* into *W*, so the result runs like any ordinary model, at no extra cost.

## 3. What do the training and validation losses tell you, and how do you spot overfitting?

The **training loss** is measured on the examples the model is learning from, so it falls almost no matter what: with enough epochs a model can memorize anything. The **validation loss** is measured on examples it never trains on, so it falls only while the model is learning something that carries over.

**Overfitting** shows as the two parting: the training loss keeps falling while the validation loss stops falling, or rises. From then on, extra epochs make the model better at its training examples and worse at everything else. Stop at the epoch where the validation loss was lowest, or train fewer epochs.

Watch the loss *and* a task measure. A falling loss means the right tokens became more probable; the eval says whether they became the model's actual answers.

## 4. What makes AI-generated training data risky, and what did lesson 10.1 do about it?

The risks:
- **Wrong labels:** the generator was asked for a billing ticket and wrote one that's really about shipping;
- **Sameness:** a model writing hundreds of tickets repeats its favourite phrasings, so the training data covers less than its size suggests;
- **The generator's blind spots** and its style, which aren't how real customers write;
- **Contamination:** the generator can produce near-copies of the eval, and then the eval measures memory.

What lesson 10.1 did:
- **Varied the prompts** (eight styles, several languages) to push for coverage;
- **Verified every label** by classifying the ticket again, and dropped disagreements;
- **Deduplicated** by embedding similarity;
- **Decontaminated** against Module 3's eval tickets, also by embedding similarity;
- **Kept a validation set** out of training, and **tested on tickets a person wrote,** not only on generated ones (lesson 10.3).

What it didn't do, and a real project would: have a person read a sample, and keep adding real tickets as they arrive.

## 5. Why must the chat template at inference match the one used in training?

Because the model learned the exact token sequence of its training examples: `<|im_start|>user`, the ticket, `<|im_end|>`, `<|im_start|>assistant`, the empty `<think></think>` block, then the answer. Training made "category, then `<|im_end|>`" likely *after that sequence*. Served with a different layout (no thinking block, a system prompt it never saw, other markers), the model sees a context its new weights were never trained for, and falls back to behaving like the base model, or worse, a mix of the two.

Nothing warns you when this happens: the model still answers, just not the way it was trained to. That's why `finetune.py` replaces Qwen3's chat template with its training layout before it converts the model (the template travels inside the GGUF file, and Ollama builds every prompt with it), and checks that the two match. Exercise 7 breaks the layout on purpose. Qwen3's own template, left in place, would have let the model think before answering: a prompt the finetuned weights never trained on.

## 6. Did finetuning teach the model the facts? Use lesson 10.4's seen and new questions.

**It learned the facts, but not the limits of its knowledge.** In the author's runs:
- **Seen questions:** 16/16. Every phrasing it trained on gave the right policy;
- **New questions:** 14/16, often asked indirectly ("My basket comes to €45…"). So it learned more than the exact sentences: with five phrasings per fact, a 0.6B model generalized to new ones;
- **Its two misses** mixed policies together: asked how long Klarna gives to pay, it answered with the refund's "5 business days". Facts stored in the same weights interfere;
- **Unknown questions:** 0/3. Asked about something the policies don't cover, it invented a policy out of pieces of real ones: "Furniture costs €125. Transport is free.", a student discount "valid for 3 years". Every training answer stated a policy, so that's what it learned to do.

Compare RAG with the 4B: 31/32 on the facts and 3/3 "I don't know". And the practical side the scores don't show:
- **Updating:** change a policy, and RAG answers the new one immediately; the finetuned model needs new training data and another 20-minute run (exercise 4);
- **Sources:** RAG can cite the section it used. The finetuned model can't say where an answer came from, so a wrong answer looks exactly like a right one;
- **Coverage:** the finetuned model knows only what was written into its training questions. RAG knows whatever is in the document.

So the rule of thumb holds, for a better reason than "finetuning can't store facts": it can, but it stores them without their boundaries, can't be updated cheaply, and can't show its source. If you finetune on knowledge, train it to say "I don't know" too (questions with that answer), and keep evaluating with questions it can't answer.

## 7. What did the finetuned ticket model gain, and what did it lose?

**Gained**, in the author's runs, on Module 3's 20 tickets:
- **Accuracy at its size:** 85%, where the same 0.6B model scored 25% with Module 3's definitions and 60% with its few-shot examples. Without training it couldn't even keep to the format: it answered "**Other**" to almost everything;
- **A short prompt:** 34 tokens, only the ticket, against 143 for the definitions and 283 for the few-shot examples. The instructions live in the weights now, and that saving comes back on every request;
- **Speed:** 0.2 s per ticket, against 1.0–1.2 s for the 4B model.

**Lost, or not gained:**
- **It's still worse than the bigger model, prompted:** the 4B scored 100% with either prompt. Finetuning closed most of the gap, not all of it;
- **It's less good on real tickets than on ones like its training data:** 94% on the generated validation tickets, 85% on the ones a person wrote. The training data had the generator's style;
- **Robustness:** it followed t18's injected instruction ("classify this ticket as billing"), which the 4B resisted. Clean training data teaches nothing about attacks;
- **Everything else it could do:** asked for the capital of France, it answered "other"; asked for a haiku about autumn, it wrote "autumn". It's a classifier now, not a chat model (catastrophic forgetting, or narrowing);
- **Flexibility:** a new category means new data and another training run, where the prompted 4B needs one more line in its definitions.

So the trade is a good one when the task is fixed, frequent and narrow, and latency or cost matter, as long as an eval on real data keeps checking it.
