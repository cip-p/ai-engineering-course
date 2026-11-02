// A tiny evaluation harness, reused in later modules.
//
// An eval has three parts:
//   cases     fixed inputs, each with the answer you expect
//   variants  the things you're comparing: prompts, models, settings
//   score     a function that grades one output against its expected answer, from 0 to 1
// Run every variant on every case, then read the numbers AND the failures.

export type EvalCase<Input, Expected> = { id: string; input: Input; expected: Expected };
export type Output = { text: string; reasoning?: string; tokensOut?: number };
export type Variant<Input> = { name: string; run: (input: Input) => Promise<Output> };
export type Score<Expected> = (output: string, expected: Expected) => number;

export type Result = {
  variant: string;
  caseId: string;
  expected: unknown;
  output: Output;
  score: number;
  seconds: number;
};

export async function runEval<Input, Expected>(spec: {
  cases: EvalCase<Input, Expected>[];
  variants: Variant<Input>[];
  score: Score<Expected>;
}): Promise<Result[]> {
  const results: Result[] = [];

  // One variant at a time, so its system prompt (identical for every case) stays in
  // Ollama's prompt cache from one case to the next (Module 1).
  for (const variant of spec.variants) {
    process.stdout.write(`${variant.name.padEnd(14)} `);
    for (const evalCase of spec.cases) {
      const start = performance.now();
      let output: Output;
      try {
        output = await variant.run(evalCase.input);
      } catch (error) {
        output = { text: `ERROR: ${(error as Error).message}` };
      }
      const score = spec.score(output.text, evalCase.expected);
      const seconds = (performance.now() - start) / 1000;
      results.push({ variant: variant.name, caseId: evalCase.id, expected: evalCase.expected, output, score, seconds });
      process.stdout.write(score === 1 ? "✓" : "✗");
    }
    process.stdout.write("\n");
  }
  return results;
}

export function printReport(results: Result[], { verbose = false, width = 100 } = {}) {
  const variants = [...new Set(results.map((r) => r.variant))];

  console.log(`\n${"variant".padEnd(14)} ${"score".padStart(6)} ${"avg time".padStart(9)} ${"avg tokens out".padStart(15)}`);
  for (const variant of variants) {
    const rows = results.filter((r) => r.variant === variant);
    const average = (pick: (r: Result) => number) => rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
    console.log(
      `${variant.padEnd(14)} ${`${(average((r) => r.score) * 100).toFixed(0)}%`.padStart(6)} ` +
        `${`${average((r) => r.seconds).toFixed(1)}s`.padStart(9)} ${average((r) => r.output.tokensOut ?? 0).toFixed(0).padStart(15)}`,
    );
  }

  // The numbers say how often; the failures say why. Always read them.
  for (const variant of variants) {
    const shown = results.filter((r) => r.variant === variant && (verbose || r.score < 1));
    if (shown.length === 0) continue;
    console.log(`\n── ${variant}: ${verbose ? "all outputs" : "failures"} ──`);
    for (const r of shown) {
      console.log(`  ${r.score === 1 ? "✓" : "✗"} ${r.caseId}  expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(oneLine(r.output.text, width))}`);
      if (verbose && r.output.reasoning) console.log(`      thinking: ${oneLine(r.output.reasoning, width)}`);
    }
  }
}

function oneLine(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
