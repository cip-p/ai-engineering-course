// Lesson 8.4: what the bot did, from its logs. The numbers say how often; the runs say why.
//
// Run:  npx tsx m08-slack/report.ts            the summary, then every 👎 and every failed run
//       npx tsx m08-slack/report.ts --export   also add the 👎 runs to cases.json, for eval.ts

import { parseArgs } from "node:util";
import { DONT_KNOW } from "../m05-rag/prompt";
import { loadCases, saveCases } from "./cases";
import { readFeedback, readRuns, type RunLog } from "./log";

const { values } = parseArgs({ options: { export: { type: "boolean", default: false } } });

const runs = readRuns();
if (runs.length === 0) {
  console.log("No runs logged yet. Start bot.ts and mention it in Slack first.");
  process.exit(0);
}

// The latest 👍/👎 on each reply. A person can change their mind; this counts the last one.
const verdicts = new Map<string, string>();
for (const feedback of readFeedback()) verdicts.set(feedback.replyTs, feedback.reaction);
const verdictOf = (run: RunLog) => (run.replyTs ? verdicts.get(run.replyTs) : undefined);
// Reactions on a reply that no run in the log produced: feedback you can't act on.
const loggedReplies = new Set(runs.map((run) => run.replyTs));
const orphans = [...verdicts.keys()].filter((replyTs) => !loggedReplies.has(replyTs)).length;

const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);
const percentile = (numbers: number[], p: number) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};
const percent = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
const short = (text: string | null, max = 160) => {
  const flat = (text ?? "(none)").replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

// ─── How often ───────────────────────────────────────────────────────────────

const answered = runs.filter((run) => run.stoppedBy === "answer");
const failed = runs.filter((run) => run.stoppedBy === "error" || run.stoppedBy === "step limit");
const refused = runs.filter((run) => run.stoppedBy === "refused");
const worked = runs.filter((run) => run.stoppedBy !== "refused"); // the runs that reached the assistant

console.log(`\n${runs.length} runs, from ${runs[0].time.slice(0, 10)} to ${runs.at(-1)!.time.slice(0, 10)}`);
console.log(
  `  answered ${answered.length} · step limit ${runs.filter((r) => r.stoppedBy === "step limit").length} · ` +
    `errors ${runs.filter((r) => r.stoppedBy === "error").length} · refused by the input guardrails ${refused.length}`,
);

if (worked.length > 0) {
  const codeSeconds = (run: RunLog) => (run.preSearch?.seconds ?? 0) + (run.retry?.search.seconds ?? 0); // your code's searches
  const total = worked.map((run) => run.queueSeconds + (run.route?.seconds ?? 0) + codeSeconds(run) + run.seconds);
  const modelTime = sum(worked.flatMap((run) => [run.route?.seconds ?? 0, ...run.steps.map((step) => step.seconds)]));
  const toolTime = sum(worked.flatMap((run) => [codeSeconds(run), ...run.tools.map((tool) => tool.seconds)]));
  const queueTime = sum(worked.map((run) => run.queueSeconds));
  const allTime = modelTime + toolTime + queueTime;

  console.log("\nTime per question, from the mention to the reply");
  console.log(`  median ${percentile(total, 50).toFixed(0)} s · p90 ${percentile(total, 90).toFixed(0)} s · slowest ${Math.max(...total).toFixed(0)} s`);
  console.log(`  where it went: model ${percent(modelTime, allTime)} · tools ${percent(toolTime, allTime)} · waiting in line ${percent(queueTime, allTime)}`);

  const firstSteps = worked.flatMap((run) => run.steps.slice(0, 1));
  console.log("\nModel calls");
  console.log(`  ${(sum(worked.map((r) => r.steps.length + (r.route ? 1 : 0))) / worked.length).toFixed(1)} per question, the router's included`);
  console.log(`  the answering model's first step reads ${(sum(firstSteps.map((s) => s.tokensIn)) / Math.max(1, firstSteps.length)).toFixed(0)} tokens on average (instructions, tool definitions, notes, question)`);

  const routed = worked.filter((run) => run.route);
  if (routed.length > 0) {
    const routes = new Map<string, number>();
    for (const run of routed) routes.set(run.route!.name, (routes.get(run.route!.name) ?? 0) + 1);
    console.log("\nRoutes");
    for (const [name, count] of [...routes].sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(16)} ${count} questions`);
    console.log(`  the router took ${(sum(routed.map((run) => run.route!.seconds)) / routed.length).toFixed(1)} s per question`);
  }

  // The model's own decisions. Your code's search-first isn't one of them, so it's counted apart.
  const toolCounts = new Map<string, number>();
  for (const run of worked) for (const tool of run.tools) toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
  console.log("\nTools the model called");
  for (const [name, count] of [...toolCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(16)} ${count} calls`);
  console.log(`  ${"(none)".padEnd(16)} ${worked.filter((run) => run.tools.length === 0).length} questions`);
  console.log(`  …and your code searched the notes first on ${worked.filter((run) => run.preSearch).length} of ${worked.length} questions`);
  const retried = worked.filter((run) => run.retry);
  if (retried.length > 0) {
    const found = retried.filter((run) => !(run.answer ?? "").includes(DONT_KNOW)).length;
    console.log(`  …and searched again after ${retried.length} "I don't know" answers: ${found} of them then found an answer`);
  }
}

const up = runs.filter((run) => verdictOf(run) === "+1");
const down = runs.filter((run) => verdictOf(run) === "-1");
const unrated = runs.filter((run) => run.replyTs && !verdictOf(run)).length;
console.log("\nFeedback");
console.log(`  👍 ${up.length} · 👎 ${down.length} · no reaction ${unrated}`);
console.log(`  ${percent(up.length + down.length, up.length + down.length + unrated)} of the replies got a reaction`);
if (orphans > 0) console.log(`  ${orphans} reaction${orphans > 1 ? "s" : ""} on replies that no logged run produced: they can't be traced`);

// ─── Why: read the runs ──────────────────────────────────────────────────────

function printRun(run: RunLog, label: string) {
  const route = run.route ? ` · route ${run.route.name}` : "";
  console.log(`\n${label} ${run.time.slice(0, 16).replace("T", " ")} · #${run.channel} · run ${run.id.slice(0, 8)}${route}`);
  console.log(`  Q: ${short(run.question) || "(empty)"}`);
  if (run.preSearch) console.log(`  · your code called ${run.preSearch.tool ?? "search_notes"} first: ${run.preSearch.result.length} characters back`);
  if (run.retry) console.log(`  · then searched again with the passage: ${short(run.retry.passage, 120)}`);
  for (const tool of run.tools) console.log(`  → ${tool.name} ${tool.arguments}  (${tool.result.length} characters back)`);
  if (run.tools.length === 0) console.log(`  → (${run.stoppedBy === "refused" ? "refused before the model" : "no tool call"})`);
  console.log(`  A: ${run.error ? `error: ${run.error}` : short(run.answer)}`);
}

for (const run of down) printRun(run, "👎");
for (const run of failed) printRun(run, "⚠");

// ─── Failures become eval cases ──────────────────────────────────────────────

if (values.export) {
  const cases = loadCases();
  const known = new Set(cases.map((c) => c.input));
  // A refused question never reached the model, so it isn't a case for the assistant's eval.
  const added = down
    .filter((run) => run.stoppedBy !== "refused" && !known.has(run.question))
    .map((run) => ({
      id: `f${run.id.slice(0, 6)}`,
      input: run.question,
      context: { channel: run.channel, asker: run.asker },
      expected: null,
      note: `👎 on ${run.time.slice(0, 10)}. It answered: ${short(run.answer, 120)}`,
    }));
  saveCases([...cases, ...added]);
  console.log(`\nAdded ${added.length} case${added.length === 1 ? "" : "s"} to m08-slack/cases.json. Write their "expected" answers (and "route"), then run eval.ts.`);
}
