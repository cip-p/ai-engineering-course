// Lesson 5.3: evaluate RAG end to end, and tell retrieval failures from generation failures.
//
// Run:  npx tsx m05-rag/rag-eval.ts             about 5–10 minutes on a CPU
// Same options as rag.ts:  --k 3  --chunk-size 800  --model / --profile

import { parseArgs } from "node:util";
import { ask, pickTarget, system, user } from "../common/llm";
import { ragMessages } from "./prompt";
import { loadQuestions, type RagQuestion } from "./questions";
import { createRetriever, sectionOf } from "./retrieve";

const { values } = parseArgs({
  options: {
    k: { type: "string", default: "3" },
    "chunk-size": { type: "string", default: "800" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const k = Number(values.k);
const chunkSize = Number(values["chunk-size"]);
const target = pickTarget(values); // the model that answers; the judge below always runs locally

const questions = loadQuestions();
const retriever = await createRetriever({ chunkSize });

// The judge: does the answer state the same key facts as the reference answer?
const JUDGE =
  "You check an answer against a reference answer. Set correct to true if the answer states the same key facts " +
  "as the reference, even in different words. Extra details are fine; a missing or contradicted key fact is not. Reply in JSON.";
const VERDICT = { type: "object", properties: { correct: { type: "boolean" } }, required: ["correct"] };

async function matchesReference(question: string, reference: string, answer: string): Promise<boolean> {
  const prompt = `Question: ${question}\n\nReference answer: ${reference}\n\nAnswer to check: ${answer}`;
  const { text } = await ask([system(JUDGE), user(prompt)], { schema: VERDICT });
  return JSON.parse(text).correct === true;
}

const saidDontKnow = (answer: string) => /i don.?t know/i.test(answer);

type Row = { question: RagQuestion; answer: string; bestSimilarity: number; foundSource: boolean; correct: boolean; seconds: number };
const rows: Row[] = [];

console.log(`Model: ${target.model} · chunks: ${chunkSize || "whole sections"} · k = ${k}\n`);
for (const question of questions) {
  process.stdout.write(`${question.id} `);
  const start = performance.now();

  const { hits, bestSimilarity } = await retriever.search(question.input, k);
  const { text: answer } = await ask(ragMessages(question.input, hits), { target });

  const { answer: reference, sections } = question.expected;
  const foundSource = hits.some((hit) => sections.includes(sectionOf(hit.chunk.id)));
  const correct = reference === null ? saidDontKnow(answer) : !saidDontKnow(answer) && (await matchesReference(question.input, reference, answer));

  rows.push({ question, answer, bestSimilarity, foundSource, correct, seconds: (performance.now() - start) / 1000 });
  console.log(correct ? "✓" : "✗");
}

// Separate the two halves of RAG: did retrieval find the source, and did generation use it?
function diagnose({ question, answer, foundSource, correct }: Row): string {
  if (question.expected.answer === null) return correct ? "✓ said it didn't know" : "✗ HALLUCINATION: answered what the notes can't answer";
  if (correct) return foundSource ? "✓" : "✓ right, but not from the expected source";
  if (foundSource) return "✗ GENERATION: had the right source, still answered wrong";
  return saidDontKnow(answer)
    ? "✗ RETRIEVAL: never saw the right source (and rightly said it didn't know)"
    : "✗ RETRIEVAL: never saw the right source, and answered anyway";
}

// The time includes the judge, which only runs when the model gave an answer.
console.log("\nid    best sim   source found   correct    time   diagnosis");
for (const row of rows) {
  const found = row.question.expected.answer === null ? "n/a" : row.foundSource ? "yes" : "NO";
  console.log(
    `${row.question.id.padEnd(5)} ${row.bestSimilarity.toFixed(2).padStart(8)} ${found.padStart(14)} ${(row.correct ? "✓" : "✗").padStart(9)} ${`${row.seconds.toFixed(1)} s`.padStart(7)}   ${diagnose(row)}`,
  );
}

console.log("\nAnswers:");
for (const row of rows) console.log(`  ${row.question.id}  ${row.answer.replace(/\s+/g, " ")}`);

const answerable = rows.filter((row) => row.question.expected.answer !== null);
const average = rows.reduce((sum, row) => sum + row.seconds, 0) / rows.length;
// Not all failures are equal: "I don't know" is safe, a wrong answer stated with
// citations is not.
const wrongAnswers = rows.filter((row) => !row.correct && !saidDontKnow(row.answer)).length;
console.log(`\nCorrect: ${rows.filter((row) => row.correct).length}/${rows.length}`);
console.log(`Wrong answers (instead of "I don't know"): ${wrongAnswers}`);
console.log(`Right source retrieved: ${answerable.filter((row) => row.foundSource).length}/${answerable.length} answerable questions`);
console.log(`Average time per question: ${average.toFixed(1)} s (retrieval + answer + judge)`);
