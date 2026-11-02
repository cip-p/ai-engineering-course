// Lesson 8.4: observability. Each run of the bot is one line of JSON in logs/runs.jsonl,
// and each 👍/👎 one line in logs/feedback.jsonl. One event per line, only ever appended:
// easy to grep, easy to load, and a crash in the middle of a write loses one line at most.
// The logs hold your workspace's messages, so they're gitignored.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { PreSearch, Reply, Retry } from "./assistant";

const DIR = new URL("./logs/", import.meta.url);
const RUNS = new URL("runs.jsonl", DIR);
const FEEDBACK = new URL("feedback.jsonl", DIR);

export type RunLog = {
  id: string;
  time: string;
  model: string;
  channel: string;
  asker: string;
  question: string;
  prompt?: string;
  answer: string | null;
  sources: string[];
  // "answer" or "step limit" (the agent), "error", or "refused" (the input guardrails said no)
  stoppedBy: string;
  error?: string;
  queueSeconds: number; // waiting for an earlier question to finish
  route?: { name: string; seconds: number }; // the router's choice, and its model call's time
  preSearch?: PreSearch; // your code's search, before the answering model started
  retry?: Retry; // search-again: the passage the model wrote, and your code's second search
  seconds: number; // the answering model's steps plus its tool calls (not the router or the search)
  steps: { tokensIn: number; tokensOut: number; seconds: number; calls: string[] }[];
  tools: { name: string; arguments: string; result: string; seconds: number }[]; // the model's calls
  replyTs?: string; // the reply's Slack id: a reaction on the reply points back to this run
};

export type FeedbackLog = { time: string; replyTs: string; channel: string; user: string; reaction: string };

const round = (seconds: number) => Math.round(seconds * 10) / 10;

// The parts of a run that the agent's events tell us.
export function traceOf(reply: Reply) {
  return {
    prompt: reply.prompt,
    route: reply.route ? { name: reply.route.name, seconds: round(reply.route.seconds) } : undefined,
    preSearch: reply.preSearch ? { ...reply.preSearch, seconds: round(reply.preSearch.seconds) } : undefined,
    retry: reply.retry ? { ...reply.retry, search: { ...reply.retry.search, seconds: round(reply.retry.search.seconds) } } : undefined,
    answer: reply.answer,
    sources: reply.sources,
    stoppedBy: reply.result.stoppedBy,
    seconds: round(reply.result.seconds),
    steps: reply.events.flatMap((e) =>
      e.kind === "model" ? [{ tokensIn: e.tokensIn, tokensOut: e.tokensOut, seconds: round(e.seconds), calls: e.calls.map((c) => c.name) }] : [],
    ),
    tools: reply.events.flatMap((e) =>
      e.kind === "tool" ? [{ name: e.call.name, arguments: e.call.arguments, result: e.result, seconds: round(e.seconds) }] : [],
    ),
  };
}

function append(file: URL, entry: object) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function readLines<T>(file: URL): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export const logRun = (run: RunLog) => append(RUNS, run);
export const logFeedback = (feedback: FeedbackLog) => append(FEEDBACK, feedback);
export const readRuns = () => readLines<RunLog>(RUNS);
export const readFeedback = () => readLines<FeedbackLog>(FEEDBACK);
