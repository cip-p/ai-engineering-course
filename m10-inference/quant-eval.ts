// Lesson 10.6: does quantization cost quality?
//
// Two Module 3 tasks on each build: the 20 tickets with the `definitions` prompt (one word
// out), and the six reasoning problems with `cot` (about 180 words out, so a small change
// early in the answer has room to grow). The scores say how often each build is right.
// The agreement table compares each build with the reference build, answer by answer.
//
// Run:  npx tsx m10-inference/quant-eval.ts           the three builds, ~15 minutes on a CPU
//       npx tsx m10-inference/quant-eval.ts --models qwen3:4b-instruct-2507-q4_K_M,qwen3:4b-instruct-2507-q8_0
//       add --verbose to see every answer, and where each one first differs from the reference

import { parseArgs } from "node:util";
import { printReport, runEval, type Result } from "../common/evals";
import { ask, system, user } from "../common/llm";
import { PROBLEMS, STEP_BY_STEP, score as problemScore } from "../m03-prompting-evals/problems";
import { ANSWER_ONLY, DEFINITIONS, loadTickets, normalize, score as ticketScore, ticketMessage } from "../m03-prompting-evals/tickets";
import { BUILDS, ollama, shortName } from "./ollama";

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    reference: { type: "string" }, // what the others are compared with: the last model by default (fp16)
    url: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
const models = values.models?.split(",") ?? BUILDS;
const reference = values.reference ?? models.at(-1)!;
const server = ollama(values.url);
const tickets = loadTickets();

const results: Record<"tickets" | "problems", Result[]> = { tickets: [], problems: [] };
for (const model of models) {
  // One build in memory at a time, loaded before the clock starts.
  await server.unloadAll();
  await server.load(model);
  const target = server.target(model);
  const name = shortName(model);
  console.log(`\n${model}`);

  const classify = (ticket: string) => ask([system(`${DEFINITIONS}\n\n${ANSWER_ONLY}`), ticketMessage(ticket)], { target });
  results.tickets.push(...(await runEval({ cases: tickets, variants: [{ name, run: classify }], score: ticketScore })));

  const reason = (problem: string) => ask([system(STEP_BY_STEP), user(problem)], { target, maxTokens: 600 });
  results.problems.push(...(await runEval({ cases: PROBLEMS, variants: [{ name, run: reason }], score: problemScore })));
}
await server.unloadAll();

console.log("\n════ tickets (definitions prompt) ════");
printReport(results.tickets, { verbose: values.verbose });
console.log("\n════ problems (cot prompt) ════");
printReport(results.problems, { verbose: values.verbose });

// Answer by answer: does a build say what the reference says?
const lastNumber = (text: string) => text.replace(/,/g, "").match(/-?\d+(\.\d+)?/g)?.at(-1) ?? "";
const firstDifference = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const outputs = (task: "tickets" | "problems", model: string) =>
  new Map(results[task].filter((r) => r.variant === shortName(model)).map((r) => [r.caseId, r.output.text]));

const ref = { tickets: outputs("tickets", reference), problems: outputs("problems", reference) };
console.log(`\n════ compared with ${shortName(reference)}, answer by answer ════`);
console.log(`${"build".padEnd(10)} ${"tickets: same category".padStart(23)} ${"problems: same text".padStart(20)} ${"same final number".padStart(18)}  first difference`);
for (const model of models.filter((m) => m !== reference)) {
  const mine = { tickets: outputs("tickets", model), problems: outputs("problems", model) };
  const sameCategory = [...mine.tickets].filter(([id, text]) => normalize(text) === normalize(ref.tickets.get(id) ?? "")).length;
  const problems = [...mine.problems].map(([id, text]) => ({ id, text, other: ref.problems.get(id) ?? "" }));
  const sameText = problems.filter((p) => p.text === p.other).length;
  const sameNumber = problems.filter((p) => lastNumber(p.text) === lastNumber(p.other)).length;
  const differences = problems.filter((p) => p.text !== p.other).map((p) => firstDifference(p.text, p.other));
  console.log(
    `${shortName(model).padEnd(10)} ${`${sameCategory}/${mine.tickets.size}`.padStart(23)} ${`${sameText}/${problems.length}`.padStart(20)} ` +
      `${`${sameNumber}/${problems.length}`.padStart(18)}  ${differences.length ? `after ${differences.sort((a, b) => a - b).join(", ")} characters` : "none"}`,
  );
  if (values.verbose) {
    for (const p of problems.filter((p) => p.text !== p.other)) {
      const at = firstDifference(p.text, p.other);
      const show = (text: string) => JSON.stringify(text.slice(Math.max(0, at - 30), at + 30));
      console.log(`    ${p.id} at ${at}: ${shortName(model)} ${show(p.text)}\n    ${" ".repeat(p.id.length + String(at).length + 4)} ${shortName(reference).padEnd(shortName(model).length)} ${show(p.other)}`);
    }
  }
}
