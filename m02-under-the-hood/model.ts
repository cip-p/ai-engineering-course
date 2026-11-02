// Shared setup for Module 2: load a small model from Hugging Face and run it ourselves,
// one forward pass at a time, instead of letting Ollama do everything.
//
// Qwen3-0.6B uses the same tokenizer as the Qwen3-4B model you chat with in Ollama,
// so the tokens you see here are exactly the tokens your course model sees.

import { AutoModelForCausalLM, AutoTokenizer, Tensor, env, type PreTrainedModel } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";

// Downloads go to .cache/ in the repo (gitignored), so they're easy to find and delete.
env.cacheDir = ".cache/transformers";

export const loadTokenizer = () => AutoTokenizer.from_pretrained(MODEL_ID);

// About 620 MB on the first run. "q8" picks the 8-bit quantized weights.
export function loadModel() {
  let downloading = false; // a cached file reports a single 100% event, so there's nothing to show
  return AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: "q8",
    progress_callback: (event: any) => {
      if (!event.file?.endsWith(".onnx")) return;
      if (event.status === "progress" && event.progress < 100) downloading = true;
      if (!downloading) return;
      if (event.status === "progress") process.stdout.write(`\rDownloading ${event.file}: ${Math.round(event.progress)}%`);
      if (event.status === "done") process.stdout.write("\n");
    },
  });
}

// Wrap a message in Qwen3's chat template: the same layout Ollama builds for you
// (compare with `ollama show <model> --template`). The empty <think></think> block
// tells Qwen3 to answer directly instead of reasoning first.
export function chatPrompt(message: string): string {
  return `<|im_start|>user\n${message}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

// One forward pass. The model reads the whole sequence and returns a score (a logit)
// for every token in its vocabulary, at every position. We keep only the last
// position: the model's scores for what comes next.
export async function nextTokenLogits(model: PreTrainedModel, ids: number[]): Promise<Float32Array> {
  const shape = [1, ids.length]; // a batch of one sequence
  const input_ids = new Tensor("int64", BigInt64Array.from(ids, (id) => BigInt(id)), shape);
  const attention_mask = new Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape);

  const { logits } = await model.forward({ input_ids, attention_mask });
  const [, length, vocabSize] = logits.dims;
  return (logits.data as Float32Array).slice((length - 1) * vocabSize, length * vocabSize);
}
