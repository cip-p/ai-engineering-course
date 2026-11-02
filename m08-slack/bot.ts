// Lessons 8.3–8.4: the Slack study assistant. When someone @mentions it:
//   1. input guardrails: ignore bots and Slack's resends, check the question;
//   2. react 👀 right away: an answer takes a minute on a CPU, so say it's working;
//   3. wait in line: one agent run at a time, so two questions don't share the CPU;
//   4. the assistant: your Module 6 agent, with MCP tools from the notes and Slack servers;
//   5. output guardrails, then the reply in the thread, with its sources;
//   6. log the run. A 👍 or 👎 on the reply is logged as feedback.
//
// Run:  npx tsx m08-slack/bot.ts
// Options:  --design search-again   or an earlier design (lesson 8.5): agent-v1, agent, search-first, router, read-first
//           --max-steps 6, --model, --profile   as in Module 6

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import { printEvent, printResult } from "../m06-agents/cli";
import { createAssistant, modelCallsOf, pickDesign, secondsOf, type Reply } from "./assistant";
import { checkQuestion, cleanAnswer, escape, questionFrom } from "./guardrails";
import { logFeedback, logRun, traceOf, type RunLog } from "./log";
import { createSlackApp } from "./slack-app";

const { values } = parseArgs({
  options: {
    design: { type: "string" }, // default: DEFAULT_DESIGN in assistant.ts
    "max-steps": { type: "string", default: "6" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const target = pickTarget(values);

const app = createSlackApp();
const assistant = await createAssistant({ target, maxSteps: Number(values["max-steps"]), design: pickDesign(values.design) });
const { user_id: botUserId } = await app.client.auth.test();

// ─── Names for the prompt: Slack events carry ids (C0…, U0…) ─────────────────

type SlackClient = typeof app.client;
const names = new Map<string, string>();

// A name, looked up once. If the lookup fails (a missing scope?), the id will do.
async function nameOf(id: string, lookup: () => Promise<string | undefined>): Promise<string> {
  if (!names.has(id)) names.set(id, (await lookup().catch(() => undefined)) || id);
  return names.get(id)!;
}

const channelName = (client: SlackClient, id: string) =>
  nameOf(id, async () => (await client.conversations.info({ channel: id })).channel?.name);

const userName = (client: SlackClient, id: string) =>
  nameOf(id, async () => {
    const { user } = await client.users.info({ user: id });
    return user?.profile?.display_name || user?.real_name;
  });

// ─── One run at a time ───────────────────────────────────────────────────────

// Ollama on a CPU would share it between two runs, and both would get slower. A question
// that arrives during a run waits here, and how long it waited is logged.
let line: Promise<unknown> = Promise.resolve();
let pending = 0; // questions waiting or running

function inLine<T>(job: () => Promise<T>): Promise<T> {
  pending++;
  const run = line.then(job).finally(() => pending--);
  line = run.catch(() => {}); // a failed run mustn't block the ones after it
  return run;
}

// The lines under every answer: its sources, then its route and what it cost.
function footer(reply: Reply, runId: string): string {
  const sources = reply.sources.length > 0 ? `Sources: ${reply.sources.slice(0, 5).join(" · ")}` : "No sources";
  const route = reply.route ? `route: ${reply.route.name} · ` : "";
  const cost = `${route}${modelCallsOf(reply)} model calls · ${secondsOf(reply).toFixed(0)} s · run ${runId.slice(0, 8)}`;
  return `\n\n_${escape(sources)}_\n_${cost}_`;
}

// ─── Mentions ────────────────────────────────────────────────────────────────

// Slack resends an event when it thinks you missed it. A message's ts is its id, so each
// message is answered once.
const seen = new Set<string>();

app.event("app_mention", async ({ event, client }) => {
  // Never answer a bot, ourselves included: two bots can answer each other forever.
  if (event.bot_id || !event.user) return;
  const user = event.user;
  const key = `${event.channel}:${event.ts}`;
  if (seen.has(key)) return;
  seen.add(key);

  const thread_ts = event.thread_ts ?? event.ts; // answer in the thread, or start one
  const reply = (text: string) => client.chat.postMessage({ channel: event.channel, thread_ts, text });
  const question = questionFrom(event.text);

  // Every reply the bot posts gets a line in the log, refusals included, so that every
  // 👍/👎 points back to a run. (Your first 👎 landed on a refusal that had no line.)
  const newRun = async (): Promise<RunLog> => ({
    id: randomUUID(),
    time: new Date().toISOString(),
    model: target.model,
    channel: await channelName(client, event.channel),
    asker: await userName(client, user),
    question,
    answer: null,
    sources: [],
    stoppedBy: "error", // until the agent says otherwise
    queueSeconds: 0,
    seconds: 0,
    steps: [],
    tools: [],
  });

  const refusal = checkQuestion(question);
  if (refusal) {
    const run = { ...(await newRun()), stoppedBy: "refused", answer: refusal };
    run.replyTs = (await reply(refusal)).ts;
    logRun(run);
    return;
  }

  await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "eyes" }).catch(() => {});
  const received = performance.now();
  if (pending > 0) console.log(`\n(a new question waits for ${pending} earlier one${pending > 1 ? "s" : ""})`);

  await inLine(async () => {
    const run = await newRun();
    run.queueSeconds = Math.round((performance.now() - received) / 100) / 10;
    console.log(`\n════ #${run.channel} · ${run.asker}: ${question}`);

    try {
      const answer = await assistant.ask(question, { channel: run.channel, asker: run.asker }, printEvent);
      printResult(answer.result);
      Object.assign(run, traceOf(answer));
      const text =
        answer.result.stoppedBy === "step limit"
          ? `I ran out of steps before finding an answer (run ${run.id.slice(0, 8)}). Could you ask more precisely?`
          : cleanAnswer(answer.answer || "(The model returned an empty answer.)") + footer(answer, run.id);
      run.replyTs = (await reply(text)).ts;
    } catch (error) {
      // The details go to the log and the terminal, not to the channel.
      run.error = (error as Error).message;
      console.error(error);
      await reply(`Sorry, something went wrong on my side (run ${run.id.slice(0, 8)}).`).catch(() => {});
    } finally {
      logRun(run);
      await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: "eyes" }).catch(() => {});
    }
  });
});

// ─── Feedback ────────────────────────────────────────────────────────────────

app.event("reaction_added", async ({ event }) => {
  // Only reactions on the bot's own replies count.
  if (event.item.type !== "message" || event.item_user !== botUserId) return;
  const reaction = event.reaction.split("::")[0]; // "+1::skin-tone-3" is still 👍
  if (reaction !== "+1" && reaction !== "-1") return;

  logFeedback({ time: new Date().toISOString(), replyTs: event.item.ts, channel: event.item.channel, user: event.user, reaction });
  console.log(`\n${reaction === "+1" ? "👍" : "👎"} on the reply ${event.item.ts}`);
});

// ─── Start ───────────────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await assistant.close(); // stops the MCP servers
  await app.stop();
  process.exit(0);
});

await app.start();
console.log(`\nStudy Buddy is online (model ${target.model}).`);
console.log(`Servers: ${assistant.servers.join(", ")}`);
console.log(`Tools: ${assistant.tools.map((t) => t.name).join(", ")} · design: ${assistant.design}`);
console.log("Mention @study-buddy in a channel it's in. Ctrl+C to stop.");
