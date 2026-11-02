# Module 10 (elective): Finetuning

*Book: chapter 7 (finetuning, LoRA), chapter 8 (dataset engineering)*

**Goal:** finetune a small model yourself, and find out with numbers what it's good for. You'll build a training set for Module 3's ticket task with AI-generated data, train a LoRA adapter on Qwen3-0.6B (seven times smaller than the course model), load the result into Ollama, and compare it with prompting. Then you'll try to teach it facts, and compare that with RAG.

## Concepts (read before running anything)

1. **Three places to change what a model does:**
   - **the prompt** (Module 3): instructions and examples, sent with every request;
   - **the context** (Modules 5 and 6): retrieved facts, sent with every request;
   - **the weights** (here): change the model itself, once, and send less every time.

   A common rule of thumb (book ch. 7): **finetune for form, retrieve for facts.** Finetuning is good at teaching a format, a style, or a narrow task, so that a small model does it well with a short prompt. As a way to add knowledge it's less dependable: the model can't show where an answer came from, and knowledge that changes means training again. Lessons 10.3 and 10.4 test both halves of that rule.

2. **What training does.** Each training example is a prompt and the answer you want. The model predicts the answer one token at a time, exactly as in Module 2, and the **loss** measures how surprised it was by each right token (cross-entropy: −log of the probability it gave that token). Training nudges the weights so that the right tokens become more likely. The loss is counted on the **answer only**: the prompt is there to condition on, not to learn to write. One pass over the data is an **epoch**. The **learning rate** sets how big each nudge is.

3. **Watching it overfit.** Some examples are held back as a **validation set** and never trained on. The training loss always falls; the validation loss falls only while the model is learning something general. When the validation loss rises while the training loss keeps falling, the model is memorizing its examples: that's **overfitting**.

4. **LoRA instead of full finetuning.** Full finetuning updates every weight, and the optimizer keeps two extra numbers per weight. For 600M weights in 32-bit floats, that's about 10 GB before any activations. **LoRA** (Low-Rank Adaptation) freezes the original weights. Next to each chosen matrix *W* (out × in), it adds two small ones, *A* (rank × in) and *B* (out × rank). The layer computes *W·x + B·A·x*, and only *A* and *B* learn. With rank 16, that's about 1.7% of the weights, so training fits on a laptop, and the result, the **adapter**, is tens of MB. Afterwards, *B·A* can be **merged** into *W*, leaving an ordinary model again.

5. **The data is most of the work** (book ch. 8). It needs:
   - **quantity:** a narrow task needs hundreds of examples, not millions;
   - **coverage:** every category, style and language you'll see in use;
   - **quality:** right labels, no duplicates;
   - **no contamination:** nothing from your eval in it, or the eval measures memory (Module 3).

   **AI-generated (synthetic) data** is cheap to make in quantity, but it has the generator's blind spots and its habits of phrasing. Verify it before you train on it, and test the result on data a person wrote.

6. **The format must match.** The model learns the exact layout of its training examples: the chat template, the markers, the empty `<think></think>` block. If Ollama serves it with a different layout, the finetuning quietly stops working. A model's **chat template** (a few lines of Jinja code that turn messages into a prompt) travels inside its GGUF file, and Ollama builds every prompt with it. So `finetune.py` replaces Qwen3's own template, which would let the model think first, with the exact layout it trained on, and checks that the two match.

7. **From training to Ollama: GGUF.** Training produces weights in Hugging Face's format (safetensors). Ollama runs **GGUF** files, the format of llama.cpp, which Ollama runs underneath: one file holding the weights, the tokenizer and the chat template, at any precision from 16-bit to the quantizations of the inference elective. `finetune.py` converts its result with llama.cpp's own converter.

8. **What finetuning costs:** the data work; compute for every training run; a model you now maintain, retrained whenever the base model or the facts change; and **narrowing**: trained on one task, the model can get worse at everything else (catastrophic forgetting).

## Setup

**Python, run through uv.** Training happens in Python, with Hugging Face's `transformers` and `peft`: like Module 2, a script you run, not code you write. [uv](https://docs.astral.sh/uv/) runs it: it reads the dependencies listed at the top of `finetune.py`, and installs them, and a suitable Python, in its own cache, without touching the rest of your system.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh      # macOS and Linux (or: brew install uv)
uv --version
```

In PowerShell: `winget install astral-sh.uv`, then open a new window.

**What the first run downloads:** PyTorch and the libraries (about 1 GB in uv's cache), Qwen3-0.6B from Hugging Face (about 1.5 GB, into `.cache/huggingface/`), and llama.cpp's converter (6 MB, into `.cache/llama.cpp/`, with `git`). Each model takes another 1.2 GB as a GGUF file in `.cache/finetune/`, and the same again once it's imported into Ollama. Plan for about 9 GB of disk; all of `.cache/` is gitignored.

**Where it runs:** `finetune.py` uses an NVIDIA GPU (CUDA) if it finds one, Apple Silicon's GPU (MPS) if it finds that, and the CPU otherwise. Every configuration trains the same way, at very different speeds. On Intel Macs it pins PyTorch 2.2.2, the last release built for them.

- **Windows:** use WSL2 for this elective. PyTorch's Windows packages on PyPI are CPU-only, and those for Linux include CUDA.
- **Google Colab** (a free GPU, if your machine is slow): open a notebook, choose a GPU runtime, then run `!git clone <this repository>`, `%cd ai-engineering-course`, `!pip install peft "transformers<5"`, and `!python m10-finetune/finetune.py`. Zip `.cache/finetune/` and download it from the Files panel, unzip it into your repo's `.cache/`, and continue with lesson 10.3 locally. The author hasn't run this path end to end.
- **Apple Silicon, faster:** [MLX-LM](https://github.com/ml-explore/mlx-lm) trains LoRA adapters natively and reads the same `messages` JSONL format (exercise 6).

| File | What it is |
|---|---|
| `make-data.ts` | Lesson 10.1: generate, verify, dedupe and decontaminate the ticket training data |
| `data/tickets-train.jsonl`, `tickets-valid.jsonl` | Its result: the training and validation tickets |
| `finetune.py` | Lesson 10.2: LoRA training, then the merged model as a GGUF file, and a Modelfile for Ollama |
| `ft-eval.ts` | Lesson 10.3: the finetuned 0.6B against prompting, on Module 3's tickets |
| `data/policies.md` | Lesson 10.4: the policies of a shop that doesn't exist |
| `data/facts-train.jsonl`, `facts-valid.jsonl`, `facts-eval.json` | Questions about those policies, for training, validation and the eval |
| `facts-eval.ts` | Lesson 10.4: finetuning against RAG, on facts no model has seen |

Changes outside this folder:
- `m03-prompting-evals/tickets.ts` holds Module 3's ticket task, so this elective runs it unchanged;
- `common/evals.ts` records `tokensIn` with each output.

## Lesson 10.1: The training data (`make-data.ts`)

The result is already in `data/`, so this lesson is optional: run it to see the process, or to make your own set (it overwrites the two files). It takes about an hour on a CPU: 40 calls that each write six tickets, then 240 short ones that check them.

```bash
npx tsx m10-finetune/make-data.ts
```

The course model writes tickets for each category in eight styles. Then the same model classifies every ticket again, and only the ones where both agree are kept. Near-duplicates are dropped, and so is anything too close to one of Module 3's 20 eval tickets. Whatever is left is split into training and validation sets.

**What to notice**
- **The rejected tickets.** Is the generator wrong, or the classifier, or is the ticket simply ambiguous?
- **The closest pairs to the eval tickets.** Would you call them contamination? Where would you put the threshold?
- **The counts per category.** Is the set balanced? Open `data/tickets-train.jsonl` and read twenty lines: do they sound like real customers, or like a model writing customers?

## Lesson 10.2: Training (`finetune.py`)

```bash
uv run m10-finetune/finetune.py
```

About 35 minutes on a CPU, including the downloads and the two conversions; a few minutes on a GPU.

**What to notice**
- **The example, as the model sees it.** The ticket in tags, the empty thinking block, the answer, `<|im_end|>`. That last token teaches it to stop.
- **The first run's extra steps:** the base model is exported and converted too, and llama.cpp's converter is fetched once.
- **The weights that are trained:** how many, and what share of the model.
- **Epoch 0** is the base model, before any training: its validation loss, and how many validation answers it already gets right with no instructions at all.
- **Train loss against validation loss,** epoch by epoch. Do they fall together? Does the validation loss stop falling?
- **The time per epoch.**

## Lesson 10.3: Into Ollama, and measured (`ft-eval.ts`)

Import the finetuned model, and the untouched base model, which `finetune.py` exported the same way:

```bash
ollama create tickets-0.6b -f .cache/finetune/tickets-0.6b/Modelfile
ollama create base-0.6b -f .cache/finetune/base-0.6b/Modelfile
ollama run tickets-0.6b "<ticket>
My parcel never arrived.
</ticket>"
```

Read the Modelfile: three lines, because the GGUF file carries the rest. `ollama show tickets-0.6b --template` prints the chat template from lesson 10.2. Then try the finetuned model on something that isn't a ticket: `ollama run tickets-0.6b "What is the capital of France?"`.

Then measure it:

```bash
npx tsx m10-finetune/ft-eval.ts
```

Six variants on two sets: Module 3's 20 tickets, written by a person, and the validation tickets, generated like the training data. About 7 minutes on a CPU.

**What to notice**
- **`0.6b tuned` against `0.6b defs` and `0.6b few-shot`:** the same model, finetuned or prompted.
- **`0.6b tuned` against `4b defs`:** a model seven times smaller, finetuned, against the course model, prompted.
- **The two sets.** Is the finetuned model as good on tickets a person wrote as on tickets like its training data?
- **The tokens-in table.** The finetuned model's prompt is only the ticket. What does that save on every request?
- **The failures.** Which tickets did training fix, and which did it break?

## Lesson 10.4: Facts: finetuning or RAG? (`facts-eval.ts`)

`data/policies.md` describes a shop that doesn't exist: 16 policies, with values no model can guess, such as a 45-day return window. `facts-train.jsonl` asks about each policy in five ways, always with the same answer.

```bash
uv run m10-finetune/finetune.py --data facts --epochs 8
ollama create facts-0.6b -f .cache/finetune/facts-0.6b/Modelfile
npx tsx m10-finetune/facts-eval.ts
```

Training takes about 20 minutes on a CPU. Eight epochs, because a fact needs more repetitions than a format. The eval runs five variants on three sets of questions: **seen** (a phrasing it trained on), **new** (one it never saw, often less direct), and **unknown** (three things the policies don't say, where the right answer is "I don't know"). The RAG variants retrieve with Module 4's hybrid search, so they need your `reciprocalRankFusion` from lesson 4.4. About 10 minutes.

**What to notice**
- **`base`:** what the untouched model does when it can't know. Does it say so, or invent a policy?
- **`tuned`, seen against new.** It learned the training questions. Did it learn the facts?
- **The unknown questions.** Which variants say they don't know, and which invent a policy? Read what the finetuned model answers.
- **The validation loss in the training log:** after which epoch did it stop improving, while the training loss kept falling?
- **`base + RAG` against `tuned`:** retrieval with no training, against training with no retrieval.
- **`tuned + RAG`:** does finetuning on the facts help, or get in the way, when the facts are in the prompt anyway?
- **The retrieval line.** When a RAG variant fails, was the right section retrieved? That's Module 5's diagnosis: retrieval or generation.

## Exercises

1. **A learning curve.** Train on 25, 50 and 100 examples (`--limit 50 --name tickets-50`, then `ollama create tickets-50 -f .cache/finetune/tickets-50/Modelfile` and `ft-eval.ts --tuned tickets-50`). How much data did this task need?
2. **The knobs.** Change one thing at a time: `--rank 4`, `--lr 1e-3`, `--epochs 1`. Read the validation loss and the eval. Which change mattered?
3. **Better data.** Read `ft-eval.ts`'s failures on Module 3's tickets. Add 20 tickets by hand that cover what the generated data missed (keep them out of the eval!), retrain, and measure.
4. **Change a fact.** In `policies.md`, change the return window to 30 days. Which variants of lesson 10.4 now give the new answer, without retraining? What would updating the finetuned model take?
5. **Quantize the finetuned model.** Ollama can't quantize a GGUF it imports, so it happens at conversion: in `export()` in `finetune.py`, change the converter's `--outtype` from `bf16` to `q8_0`, retrain with `--name tickets-q8`, import it, and run `ft-eval.ts --tuned tickets-q8`. Does a 0.6B model lose more from 8 bits than the 4B did in the inference elective?
6. **MLX on Apple Silicon.** Train the same adapter with `mlx_lm.lora` on `data/tickets-*.jsonl` (rename them `train.jsonl` and `valid.jsonl`), and compare the time per epoch. Fuse it with `mlx_lm.fuse`; on Apple Silicon, Ollama can import the fused safetensors folder directly, but check its chat template first (concept 6).
7. **The template trap.** Send the finetuned model a ticket as a raw prompt, which skips the chat template, once in its training layout and once without the empty `<think></think>` block:
   ```bash
   curl http://localhost:11434/api/generate -d '{"model": "tickets-0.6b", "raw": true, "stream": false, "prompt": "<|im_start|>user\n<ticket>\nMy parcel never arrived.\n</ticket><|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"}'
   ```
   Then remove `<think>\n\n</think>\n\n` from the prompt and send it again. Try a few tickets. What does a small change in the layout do to the finetuned behaviour?

## Checkpoint (answer in your own words)

1. When would you finetune instead of writing a better prompt? When would you use RAG instead of finetuning?
2. What does LoRA train, and why does it need so much less memory than full finetuning?
3. What do the training and validation losses tell you, and how do you spot overfitting?
4. What makes AI-generated training data risky, and what did lesson 10.1 do about it?
5. Why must the chat template at inference match the one used in training?
6. Did finetuning teach the model the facts? Use lesson 10.4's seen and new questions.
7. What did the finetuned ticket model gain, and what did it lose?

Reference answers for review: [`checkpoint-answers.md`](checkpoint-answers.md)

## Reference results (Intel i7 laptop, 16 GB, CPU only)

The author's numbers, from a 6-core Intel i7 laptop with 16 GB and no GPU. PyTorch 2.2.2 and transformers 4.53.3 (the Intel Mac pins), Ollama 0.40.6. Compare the shape, not the digits: on a GPU, training takes minutes.

| Measurement | Value |
|---|---|
| 10.1, generated | 240 tickets: 5 categories × 8 styles × 6, in about an hour (sharing the CPU with other runs) |
| 10.1, verification | 214 kept, 26 dropped: mostly login problems written as `technical` and classified as `account`, and jokes ("delivered to the Moon") classified as `other` |
| 10.1, near-duplicates | none above 0.95 |
| 10.1, contamination | 1 dropped, at 0.910 from t04. The next closest, 0.891, also next to t04, was kept |
| 10.1, the result | 179 training tickets (billing 40, technical 38, shipping 35, account 40, other 26) and 34 validation tickets |
| 10.2, what's trained | 10.1M of 596M weights (1.7%): a 39 MB adapter. Each model as GGUF: 1.2 GB |
| 10.2, the tickets, by epoch (0 = before training) | validation loss 18.51 → 0.253 → 0.058 → 0.047 · validation answers right 0% → 82% → 97% → 94% · training loss 3.55 → 0.126 → 0.046 |
| 10.2, time | 9–10 minutes per epoch on the CPU, 29.6 for three; about 2 minutes to convert each model to GGUF |
| 10.3, Module 3's 20 tickets | 0.6b bare 10% · defs 25% · few-shot 60% · **tuned 85%** · 4b defs 100% · 4b few-shot 100% |
| 10.3, the 34 validation tickets | 9% · 18% · 56% · **94%** · 100% · 100% |
| 10.3, time per ticket (Module 3's) | 0.6b tuned 0.2 s · 4b defs 1.2 s · 4b few-shot 1.0 s |
| 10.3, prompt tokens | 0.6b tuned 34 · bare 44 · defs 147 · few-shot 287 (the 4B's prompts: 143 and 283) |
| 10.3, the tuned model's failures | t08 → `other`, t11 → `billing`, and t18, the injection, → `billing`, as the injection asked |
| 10.3, off the task | "What is the capital of France?" → `other`. "Write a haiku about autumn." → "autumn" |
| 10.4, the facts, by epoch | validation loss 2.758 → 1.151 → 0.312 → 0.068 → 0.036 → 0.024 → 0.017 → 0.017 → 0.017 · training loss down to 0.002 · 19.5 minutes for eight epochs |
| 10.4, base | seen 4/16 · new 3/16 · unknown 0/3 |
| 10.4, base + RAG | seen 13/16 · new 15/16 · unknown 2/3 |
| 10.4, tuned | seen **16/16** · new **14/16** · unknown **0/3** |
| 10.4, tuned + RAG | seen 16/16 · new 16/16 · unknown 0/3 |
| 10.4, 4b + RAG | seen 16/16 · new 15/16 · unknown **3/3** |
| 10.4, retrieval | the right section in the top 3: 16/16 for both sets |
| 10.4, time per question (new) | tuned 1.7 s · tuned + RAG 2.2 s · base + RAG 3.4 s · 4b + RAG 5.0 s |

**What these runs showed**
- **Finetuning made the small model good at the task, not as good as the big one.** Trained on 179 generated tickets, the 0.6B model went from 25% (definitions) and 60% (few-shot) to 85% on tickets a person wrote, with a prompt of only the ticket, five times faster than the 4B. The 4B, prompted, still scored 100%.
- **It learned its training data's style.** 94% on generated tickets like the ones it trained on, 85% on human ones. Lesson 10.1's checks kept the data clean; they couldn't make it sound like real customers.
- **It learned nothing about attacks.** The finetuned model followed t18's injected instruction, which the 4B resisted. Its training data had no injections.
- **One epoch did most of the work.** The validation loss fell from 18.5 to 0.25 in the first epoch. In the third, it still fell, while one validation ticket flipped from right to wrong: loss and accuracy don't move in lockstep.
- **It's a classifier now.** It answers any question with a category, or a single word: narrowing, in two prompts.
- **Finetuning did store the facts,** better than the rule of thumb suggests: every trained question right, and 14 of 16 asked in new, less direct ways. With five phrasings per fact and eight epochs, a 0.6B model learned 16 short policies.
- **But it didn't learn what it doesn't know.** Every training answer stated a policy, so it answers every question with one. Asked about furniture assembly, it said "Furniture costs €125. Transport is free.", and about a student discount, that it "is valid for 3 years": pieces of real policies, recombined. With the right sections in its prompt it still did it ("the Erasmus student discount"). Its two misses on new questions were the same kind of mix: Klarna's payment term became the refund's 5 business days.
- **RAG knew what it didn't know, with a model good enough to read.** The 4B with retrieval was the only variant to say "I don't know" to all three unknown questions, while getting 31 of the 32 facts. The base 0.6B with retrieval got 28 of the 32 facts, but also answered "does not offer gift wrapping", a policy that isn't in the document.
- **Retrieval was perfect here, so every RAG failure was generation.** Sixteen short sections are an easy index. Module 5's diagnosis applies: the right section was in the prompt each time.
- **The pipeline had more traps than the training.** On this Intel Mac: PyTorch found the 4 GB AMD GPU and ran out of memory on it; Ollama 0.40.6's import of safetensors needs Apple Silicon (its MLX runner), hence the GGUF conversion; Ollama builds prompts from the chat template inside the GGUF, not the Modelfile's, and Qwen3's own would have let the finetuned model think first; and Jinja dropped the template's last newline until the template was rewritten. `finetune.py` handles all four.

## Troubleshooting

| Problem | Fix |
|---|---|
| `uv: command not found` | Install uv (Setup), then open a new terminal |
| `No solution found when resolving script dependencies` | Your Python platform has no PyTorch build that fits. On Windows, use WSL2; elsewhere, read which package it names |
| `Disabling PyTorch because PyTorch >= 2.x is required` | transformers is newer than your PyTorch. On an Intel Mac, `finetune.py` pins compatible versions: run it with `uv run`, not with another Python |
| Training is very slow | Expected on a CPU. Try `--limit 50` first, or train in Colab (Setup) |
| `Killed`, or the machine swaps heavily | Not enough memory: close other apps, or lower `--batch` to 4 |
| `git` fails while fetching llama.cpp's converter | Check your network, delete `.cache/llama.cpp/`, and run again. The converter is fetched only once |
| The conversion to GGUF fails | Read the converter's error by running it yourself: the command is in `export()` in `finetune.py`. An unknown architecture means the pinned converter is older than the model |
| `ollama create` fails with `unknown model architecture` | Your Ollama is too old for Qwen3: update Ollama |
| The finetuned model thinks, or writes long text instead of a category | It's served with a different layout than it was trained on. Check `ollama show <model> --template` (see concept 6 and exercise 7) |
| `model "tickets-0.6b" not found` | Run lesson 10.3's `ollama create` commands first |
| Any other error | Read the whole output: the first error line usually names the file and the cause. If you follow the course with an AI tutor, paste it the full output |
