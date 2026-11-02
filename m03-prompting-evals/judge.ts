// Lesson 3.4: LLM-as-judge, and how to catch its biases.
//
// Each pair has a good answer and a bad one (we know which, by design). The judge sees
// every pair twice, with the order swapped. A fair judge picks the good answer both times.
//
// Run:  npx tsx m03-prompting-evals/judge.ts

import * as z from "zod";
import { ask, system, user } from "../common/llm";

const PAIRS = [
  {
    question: "What causes the seasons on Earth?",
    good: "The tilt of Earth's axis, about 23.5°. Over the year, each hemisphere takes turns facing the Sun more directly.",
    bad: "The seasons happen because Earth's orbit is an ellipse, so at some times of the year we are much closer to the Sun, which makes it summer, and at other times we are much farther away, which makes it winter. This change in distance is the main factor, and it affects the whole planet at the same time.",
  },
  {
    question: "How many bytes are in a kilobyte?",
    good: "1,000 bytes in the SI definition. In computing, 'kilobyte' is often used for 1,024 bytes, which is formally a kibibyte (KiB).",
    bad: "A kilobyte is exactly 100 bytes.",
  },
  {
    question: "Is it safe to look at the Sun during a partial solar eclipse?",
    good: "No. Even when most of the Sun is covered, the visible part can burn your retina. Use certified eclipse glasses or a pinhole projector.",
    bad: "Yes, mostly. During an eclipse the Moon blocks a large part of the Sun, so the light is much dimmer than usual, and looking at it for short periods is generally considered fine. Many people watch eclipses this way, and if you blink regularly and look away from time to time, your eyes will be well protected.",
  },
  {
    question: "What does HTTP status code 404 mean?",
    good: "Not Found: the server is reachable, but it has nothing at the requested URL.",
    bad: "It means the server crashed while handling the request.",
  },
];

const JUDGE = "You are judging two answers to the same question. Decide which answer is better. Reply in JSON.";
const Verdict = z.object({ winner: z.enum(["A", "B"]) });
const schema = z.toJSONSchema(Verdict);

async function judge(question: string, answerA: string, answerB: string): Promise<"A" | "B"> {
  const prompt = `Question: ${question}\n\n<answer_A>\n${answerA}\n</answer_A>\n\n<answer_B>\n${answerB}\n</answer_B>`;
  const { text } = await ask([system(JUDGE), user(prompt)], { schema });
  return Verdict.parse(JSON.parse(text)).winner;
}

let correct = 0;
let consistent = 0;

console.log("question                                     good as A   good as B   consistent   bad is longer");
for (const { question, good, bad } of PAIRS) {
  const goodFirst = (await judge(question, good, bad)) === "A"; // did it pick the good answer when shown first?
  const goodSecond = (await judge(question, bad, good)) === "B"; // ...and when shown second?

  correct += Number(goodFirst) + Number(goodSecond);
  if (goodFirst === goodSecond) consistent++;

  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  console.log(
    `${question.slice(0, 44).padEnd(44)} ${mark(goodFirst).padStart(9)} ${mark(goodSecond).padStart(11)} ` +
      `${(goodFirst === goodSecond ? "yes" : "NO").padStart(12)} ${(bad.length > good.length ? "yes" : "no").padStart(15)}`,
  );
}

console.log(`\nCorrect verdicts: ${correct}/${PAIRS.length * 2}`);
console.log(`Same verdict in both orders: ${consistent}/${PAIRS.length}`);
console.log("A verdict that flips when only the order changes is position bias.");
console.log("A long wrong answer beating a short right one is verbosity bias.");
