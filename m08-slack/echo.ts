// Lesson 8.1: the smallest Slack bot. Mention it in a channel and it replies, in a thread,
// with what Slack sent. No model yet: this checks your tokens, scopes and Socket Mode.
//
// Run:  npx tsx m08-slack/echo.ts            then, in Slack:  @study-buddy hello
//       npx tsx m08-slack/echo.ts --debug    Bolt's own log: every message on the WebSocket

import { parseArgs } from "node:util";
import { escape } from "./guardrails";
import { createSlackApp } from "./slack-app";

const { values } = parseArgs({ options: { debug: { type: "boolean", default: false } } });
const app = createSlackApp({ debug: values.debug });

// Slack sends an "app_mention" event whenever someone writes @study-buddy in a channel
// the bot is in. When this function runs, Bolt has already acknowledged the event.
app.event("app_mention", async ({ event, client }) => {
  console.log(`\n── app_mention event\n${JSON.stringify(event, null, 2)}`);
  await client.chat.postMessage({
    channel: event.channel,
    // A message's ts is its id. Replying with thread_ts puts the reply in that message's thread.
    thread_ts: event.thread_ts ?? event.ts,
    // escape() shows Slack's markup as text: "<@U…>" would otherwise be a mention again.
    text: `Slack sent me this text: ${escape(event.text)}\nchannel ${event.channel} · message ts ${event.ts}`,
  });
});

await app.start();
console.log("echo bot: connected to Slack over Socket Mode. Mention it in a channel it's in. Ctrl+C to stop.");
