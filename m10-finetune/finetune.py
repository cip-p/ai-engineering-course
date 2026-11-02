# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   # Intel Macs: PyTorch 2.2.2 is the last release built for them. It needs numpy 1, and
#   # transformers 4.53 is the last release that still accepts it.
#   "torch==2.2.2; sys_platform == 'darwin' and platform_machine == 'x86_64'",
#   "numpy<2; sys_platform == 'darwin' and platform_machine == 'x86_64'",
#   "transformers>=4.51,<4.54; sys_platform == 'darwin' and platform_machine == 'x86_64'",
#   # Everywhere else: current releases (llama.cpp's converter wants transformers 4.x).
#   "torch>=2.6; sys_platform != 'darwin' or platform_machine != 'x86_64'",
#   "transformers>=4.56,<5; sys_platform != 'darwin' or platform_machine != 'x86_64'",
#   "peft>=0.15",
#   # For llama.cpp's converter to GGUF, the format Ollama runs.
#   "sentencepiece",
#   "protobuf<5",
# ]
# ///
"""Lesson 10.2: LoRA-finetune Qwen3-0.6B on a chat dataset, then get it ready for Ollama.

Run:  uv run m10-finetune/finetune.py                    the tickets, ~35 minutes on a CPU
      uv run m10-finetune/finetune.py --data facts --epochs 8      lesson 10.4
      uv run m10-finetune/finetune.py --limit 50 --name tickets-50  exercise 1: less data

It trains a small set of extra weights (a LoRA adapter) on m10-finetune/data/<data>-train.jsonl,
measures the loss on <data>-valid.jsonl after every epoch, then merges the adapter into the
model, converts it to GGUF (the file format Ollama runs) with llama.cpp's converter, and
writes a Modelfile next to it, in .cache/finetune/<name>/. The first run also exports the
untouched base model the same way, so lesson 10.3 compares like with like.

The script runs on whatever it finds: an NVIDIA GPU (CUDA), Apple Silicon's GPU (MPS), or
the CPU. In Google Colab, `pip install peft "transformers<5"` and run it with `python` instead of `uv run`.
"""

import argparse
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
# Downloads go to .cache/ in the repo (gitignored), like Module 2's, so they're easy to find and delete.
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")  # quiets a warning when the converter starts

import torch  # noqa: E402  (after HF_HOME, which the libraries read when they're imported)
import transformers  # noqa: E402
from peft import LoraConfig, get_peft_model  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402

BASE = "Qwen/Qwen3-0.6B"

parser = argparse.ArgumentParser()
parser.add_argument("--data", default="tickets", help="which data/<data>-train.jsonl and -valid.jsonl to use")
parser.add_argument("--name", help="the output folder and Ollama model name (default: <data>-0.6b)")
parser.add_argument("--epochs", type=int, default=3, help="passes over the training data")
parser.add_argument("--rank", type=int, default=16, help="LoRA rank: the size of the small matrices that get trained")
parser.add_argument("--lr", type=float, default=2e-4, help="learning rate")
parser.add_argument("--batch", type=int, default=8, help="examples per training step")
parser.add_argument("--limit", type=int, help="train on only N of the examples, picked at random")
parser.add_argument("--seed", type=int, default=0)
parser.add_argument("--device", choices=["cuda", "mps", "cpu"], help="override the automatic choice")
args = parser.parse_args()
name = args.name or f"{args.data}-0.6b"
out = ROOT / ".cache" / "finetune" / name

random.seed(args.seed)
torch.manual_seed(args.seed)

# ─── The device ───────────────────────────────────────────────────────────────

# Intel Macs with an AMD GPU offer MPS too, but with a few GB of graphics memory it runs
# out during training, so MPS is chosen automatically only on Apple Silicon.
apple_silicon = sys.platform == "darwin" and platform.machine() == "arm64"
if args.device:
    device = args.device
elif torch.cuda.is_available():
    device = "cuda"
elif apple_silicon and torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"
# NVIDIA GPUs train fast and accurately in bfloat16; elsewhere float32 is the safe choice.
dtype = torch.bfloat16 if device == "cuda" else torch.float32
print(f"device: {device} · torch {torch.__version__} · transformers {transformers.__version__}")

# ─── The data, in the exact layout the model will see in Ollama ───────────────

# Qwen3's chat format, written out (Module 2's chatPrompt is the same). The empty
# <think></think> block tells Qwen3 to answer directly.
def prompt_text(messages):
    turns = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
    return f"{turns}<|im_start|>assistant\n<think>\n\n</think>\n\n"


# The same layout as a chat template, the Jinja code that turns messages into a prompt.
# It travels inside the GGUF file, and Ollama builds every prompt with it. Qwen3's own
# template would let the model think first: train on one layout and serve another, and
# the finetuning quietly stops working.
# (Written as Jinja strings, '…', because Jinja drops a template's last newline otherwise.)
CHAT_TEMPLATE = (
    "{%- for message in messages %}{{ '<|im_start|>' + message.role + '\\n' + message.content + '<|im_end|>\\n' }}{%- endfor %}"
    "{{ '<|im_start|>assistant\\n<think>\\n\\n</think>\\n\\n' }}"
)


def load(split):
    path = HERE / "data" / f"{args.data}-{split}.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    # The last message is the answer to learn; everything before it is the prompt.
    return [(prompt_text(r["messages"][:-1]), r["messages"][-1]["content"] + "<|im_end|>") for r in rows]


train, valid = load("train"), load("valid")
if args.limit:
    random.shuffle(train)
    train = train[: args.limit]
print(f"data: {len(train)} training and {len(valid)} validation examples from data/{args.data}-*.jsonl")
print(f"one example, as the model sees it:\n{'─' * 60}\n{train[0][0]}{train[0][1]}\n{'─' * 60}")

tokenizer = AutoTokenizer.from_pretrained(BASE)
tokenizer.chat_template = CHAT_TEMPLATE
hello = [{"role": "user", "content": "Hello"}]
assert tokenizer.apply_chat_template(hello, tokenize=False) == prompt_text(hello), "the two layouts differ"


def encode(example):
    prompt, answer = example
    prompt_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
    answer_ids = tokenizer(answer, add_special_tokens=False)["input_ids"]
    # Labels say what to learn: -100 means "don't learn this token". Only the answer
    # counts, so the model learns to answer tickets, not to write them.
    return prompt_ids + answer_ids, [-100] * len(prompt_ids) + answer_ids


def batches(examples, size, shuffle):
    order = list(range(len(examples)))
    if shuffle:
        random.shuffle(order)
    for start in range(0, len(order), size):
        encoded = [encode(examples[i]) for i in order[start : start + size]]
        width = max(len(ids) for ids, _ in encoded)
        pad = tokenizer.pad_token_id
        # Pad every sequence to the longest one; the attention mask hides the padding.
        ids = torch.tensor([ids + [pad] * (width - len(ids)) for ids, _ in encoded])
        labels = torch.tensor([labels + [-100] * (width - len(labels)) for _, labels in encoded])
        mask = torch.tensor([[1] * len(ids) + [0] * (width - len(ids)) for ids, _ in encoded])
        yield ids.to(device), labels.to(device), mask.to(device)


# ─── The model ────────────────────────────────────────────────────────────────

# transformers 4.56 renamed torch_dtype to dtype.
new_api = tuple(int(x) for x in transformers.__version__.split(".")[:2]) >= (4, 56)
dtype_arg = {"dtype": dtype} if new_api else {"torch_dtype": dtype}


# llama.cpp's converter from Hugging Face's format to GGUF, at the version the course was
# tested with. Only the three paths it needs are checked out, into .cache/llama.cpp/.
LLAMA_CPP = "https://github.com/ggml-org/llama.cpp"
LLAMA_CPP_COMMIT = "cd8427d018c07eefab6c110f7f115c31ec4c6157"


def converter():
    folder = ROOT / ".cache" / "llama.cpp"
    script = folder / "convert_hf_to_gguf.py"
    if not script.exists():
        print(f"fetching llama.cpp's converter into {folder.relative_to(ROOT)}/")
        folder.mkdir(parents=True, exist_ok=True)
        for command in (
            ["init", "-q"],
            ["remote", "add", "origin", LLAMA_CPP],
            ["sparse-checkout", "set", "--no-cone", "/convert_hf_to_gguf.py", "/conversion/", "/gguf-py/"],
            ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", LLAMA_CPP_COMMIT],
            ["checkout", "-q", "FETCH_HEAD"],
        ):
            subprocess.run(["git", *command], cwd=folder, check=True)
    return script


def export(model, folder, label):
    """Save a model as a GGUF file that `ollama create` imports, plus a Modelfile for it."""
    folder.mkdir(parents=True, exist_ok=True)
    hf = folder / "hf"  # Hugging Face's format first: safetensors, config, tokenizer
    model.to(torch.bfloat16).save_pretrained(hf, safe_serialization=True)
    tokenizer.save_pretrained(hf)  # with CHAT_TEMPLATE
    print(f"converting {label} to GGUF")
    subprocess.run(
        [sys.executable, str(converter()), str(hf), "--outfile", str(folder / "model.gguf"), "--outtype", "bf16"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    shutil.rmtree(hf)  # the GGUF file holds everything: weights, tokenizer, chat template
    (folder / "Modelfile").write_text('FROM ./model.gguf\nPARAMETER stop "<|im_end|>"\nPARAMETER temperature 0\n')
    print(f"{label} saved in {folder.relative_to(ROOT)}/")


base_dir = ROOT / ".cache" / "finetune" / "base-0.6b"
if not (base_dir / "model.gguf").exists():
    export(AutoModelForCausalLM.from_pretrained(BASE, **dtype_arg), base_dir, "the untouched base model")

model = AutoModelForCausalLM.from_pretrained(BASE, **dtype_arg).to(device)
total = sum(p.numel() for p in model.parameters())

# LoRA: freeze every original weight, and next to each chosen matrix W add two small ones,
# A (rank × in) and B (out × rank). The layer computes W·x + B·A·x, and only A and B learn.
# B starts at zero, so before training the model is exactly the base model.
lora = LoraConfig(
    r=args.rank,
    lora_alpha=2 * args.rank,  # scales B·A; twice the rank is a common default
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora)
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"model: {BASE}, {total / 1e6:.0f}M weights, of which {trainable / 1e6:.1f}M ({100 * trainable / total:.1f}%) are trained")

# ─── Training ─────────────────────────────────────────────────────────────────

@torch.no_grad()
def evaluate():
    """Loss on the validation set, and how many answers the model gets exactly right
    (every answer token is the model's top choice, given the prompt)."""
    model.eval()
    losses, right = [], 0
    for ids, labels, mask in batches(valid, args.batch, shuffle=False):
        output = model(input_ids=ids, attention_mask=mask, labels=labels)
        losses.append(output.loss.item())
        # The prediction at position i is for token i + 1.
        predicted = output.logits[:, :-1].argmax(-1)
        target = labels[:, 1:]
        counted = target != -100
        right += ((predicted == target) | ~counted).all(dim=1).sum().item()
    model.train()
    return sum(losses) / len(losses), right / len(valid)


steps = args.epochs * math.ceil(len(train) / args.batch)
optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr)
# Warm up for the first 10% of steps, then decay linearly to zero.
warmup = max(1, steps // 10)
schedule = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda s: min((s + 1) / warmup, max(0.0, (steps - s) / (steps - warmup))))

loss, accuracy = evaluate()
print(f"\n{'epoch':>5} {'train loss':>11} {'valid loss':>11} {'valid answers right':>20} {'time':>8}")
print(f"{0:>5} {'':>11} {loss:>11.3f} {accuracy:>20.0%} {'':>8}")
log = [{"epoch": 0, "valid_loss": loss, "valid_right": accuracy}]
model.train()
start = time.time()
for epoch in range(1, args.epochs + 1):
    losses = []
    for ids, labels, mask in batches(train, args.batch, shuffle=True):
        # One step: predict every token, measure the loss on the answer tokens, and move
        # A and B a little in the direction that lowers it.
        loss = model(input_ids=ids, attention_mask=mask, labels=labels).loss
        loss.backward()
        optimizer.step()
        schedule.step()
        optimizer.zero_grad()
        losses.append(loss.item())
    train_loss = sum(losses) / len(losses)
    loss, accuracy = evaluate()
    minutes = (time.time() - start) / 60
    print(f"{epoch:>5} {train_loss:>11.3f} {loss:>11.3f} {accuracy:>20.0%} {minutes:>6.1f} m")
    log.append({"epoch": epoch, "train_loss": train_loss, "valid_loss": loss, "valid_right": accuracy, "minutes": minutes})

# ─── Save ─────────────────────────────────────────────────────────────────────

out.mkdir(parents=True, exist_ok=True)
model.save_pretrained(out / "adapter")  # the adapter alone: a few tens of MB
(out / "log.json").write_text(json.dumps({"args": vars(args), "device": device, "log": log}, indent=2))
# Fold B·A into W, so the result is an ordinary model again, with no LoRA layers.
export(model.merge_and_unload(), out, "the finetuned model")

print("\nNext, import both into Ollama (from the repo root):")
print(f"  ollama create {name} -f .cache/finetune/{name}/Modelfile")
print("  ollama create base-0.6b -f .cache/finetune/base-0.6b/Modelfile")
