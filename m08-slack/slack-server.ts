// Lesson 8.2: Slack as an MCP server, built like Module 7's notes-server.ts. Three tools:
//   - read_channel and search_messages only read;
//   - post_message writes, so only a host where a human approves each call should offer it.
// It reaches Slack with the bot token, and can do only what the token's scopes allow.
//
// A host starts it, with SLACK_BOT_TOKEN in its environment:
//   - assistant.ts (bot.ts, eval.ts) passes the token and nothing else from .env;
//   - the Inspector, with the token read from .env:
//     npx @modelcontextprotocol/inspector -e SLACK_BOT_TOKEN="$(grep '^SLACK_BOT_TOKEN=' .env | cut -d= -f2-)" npx tsx m08-slack/slack-server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebClient } from "@slack/web-api";
import * as z from "zod";
import { bm25Index } from "../m04-embeddings/bm25";

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error("slack server: SLACK_BOT_TOKEN is not set. The host must pass it (see the top of this file).");
  process.exit(1);
}
const slack = new WebClient(token);
const server = new McpServer({ name: "slack", version: "1.0.0" });

// ─── Helpers: channel names, people's names, messages as text ────────────────

type Channel = { id: string; name: string };

// The public channels the bot is in. The model says "study" or "#study"; the API wants an id.
async function myChannels(): Promise<Channel[]> {
  const { channels = [] } = await slack.conversations.list({ types: "public_channel", exclude_archived: true, limit: 200 });
  return channels.flatMap((c) => (c.is_member && c.id && c.name ? [{ id: c.id, name: c.name }] : []));
}

// A tool error the model can act on: thrown errors become results marked isError (Module 7).
async function findChannel(nameOrId: string): Promise<Channel> {
  const wanted = nameOrId.trim().replace(/^#/, "").toLowerCase();
  const channels = await myChannels();
  const channel = channels.find((c) => c.name === wanted || c.id.toLowerCase() === wanted);
  if (channel) return channel;
  const names = channels.map((c) => `#${c.name}`).join(", ");
  throw new Error(`the bot isn't in a channel called "${nameOrId}". It's in: ${names || "none yet (invite it with /invite)"}`);
}

const names = new Map<string, string>(); // user id → name, so each person is looked up once

async function nameOf(userId: string | undefined): Promise<string> {
  if (!userId) return "someone";
  if (!names.has(userId)) {
    try {
      const { user } = await slack.users.info({ user: userId });
      names.set(userId, user?.profile?.display_name || user?.real_name || user?.name || userId);
    } catch {
      names.set(userId, userId); // no users:read scope, or a deleted user: keep the id
    }
  }
  return names.get(userId)!;
}

// Slack's markup, as the model should read it: "<@U07ABC>" becomes "@Ana", "<#C01|study>"
// becomes "#study", and a link shows its address. Unescaping &lt; brings back any "<!channel>"
// a person typed as text: the model may copy it, so bot.ts escapes everything it posts.
async function readable(text: string): Promise<string> {
  let out = text;
  for (const [mention, id] of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)) out = out.replace(mention, `@${await nameOf(id)}`);
  return out
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<!(\w+)[^>]*>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type Message = { channel: string; who: string; when: string; text: string; replies: number };

// "1 Nov 2026, 17:05": close to the "1 November 2026" in the assistant's context line, so a
// small model can tell which messages are from today. "01/11/2026" was harder to match.
const timeOf = (ts = "0") => new Date(Number(ts) * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

// The latest messages of a channel, oldest first. Thread replies aren't included:
// conversations.history returns only the first message of each thread.
async function latest(channel: Channel, limit: number): Promise<Message[]> {
  const { messages = [] } = await slack.conversations.history({ channel: channel.id, limit });
  const result: Message[] = [];
  for (const m of messages.reverse()) {
    if (!m.text || m.subtype === "channel_join") continue;
    result.push({
      channel: channel.name,
      who: m.bot_id ? `${m.username ?? "a bot"} (bot)` : await nameOf(m.user),
      when: timeOf(m.ts),
      text: await readable(m.text),
      replies: m.reply_count ?? 0,
    });
  }
  return result;
}

const threadNote = (m: Message) => (m.replies > 0 ? ` (${m.replies} replies in its thread)` : "");

// ─── Tools ───────────────────────────────────────────────────────────────────

server.registerTool(
  "read_channel",
  {
    title: "Read a Slack channel",
    description: "Read the latest 20 messages of one of the user's Slack channels, oldest first.",
    inputSchema: { channel: z.string().describe('The channel\'s name, e.g. "study"') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ channel }) => {
    const found = await findChannel(channel);
    const messages = await latest(found, 20);
    const lines = messages.map((m) => `[${m.when}] ${m.who}: ${m.text}${threadNote(m)}`);
    return { content: [{ type: "text", text: `#${found.name}, latest ${messages.length} messages:\n${lines.join("\n") || "(none)"}` }] };
  },
);

server.registerTool(
  "search_messages",
  {
    title: "Search Slack messages",
    description: "Search the latest messages of the user's Slack channels by keywords. Returns the 5 best matches.",
    inputSchema: { query: z.string().describe("The words to look for") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query }) => {
    // Slack's own search API (search.messages) needs a user token, not a bot token. So the
    // server fetches the latest 100 messages of each channel and ranks them with Module 4's BM25.
    const messages = (await Promise.all((await myChannels()).map((c) => latest(c, 100)))).flat();
    if (messages.length === 0) return { content: [{ type: "text", text: "No messages: the bot isn't in any channel with messages." }] };

    const search = bm25Index(messages.map((m, i) => ({ id: String(i), title: `#${m.channel} ${m.who}`, text: m.text })));
    const hits = search(query, 5).map((hit) => messages[Number(hit.chunk.id)]);
    const text = hits.map((m, i) => `[${i + 1}] #${m.channel} · ${m.who} · ${m.when}\n${m.text}${threadNote(m)}`).join("\n\n");
    return { content: [{ type: "text", text: text || `No message contains any of these words: ${query}` }] };
  },
);

server.registerTool(
  "post_message",
  {
    title: "Post a Slack message",
    description: "Post a message to one of the user's Slack channels, as the bot. Everyone in the channel sees it.",
    inputSchema: {
      channel: z.string().describe('The channel\'s name, e.g. "study"'),
      text: z.string().describe("The message"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ channel, text }) => {
    const found = await findChannel(channel);
    // Exercise 2 puts an allow-list here. In the server's code, it holds for every host.
    const { ts } = await slack.chat.postMessage({ channel: found.id, text });
    return { content: [{ type: "text", text: `Posted to #${found.name} (message ts ${ts}).` }] };
  },
);

await server.connect(new StdioServerTransport());
console.error("slack server: ready on stdio"); // stderr: stdout belongs to the protocol
