// Module 9, lesson 9.1: your Module 8 assistant as an HTTP service, for the web UI in ui/.
// POST /ask with {question, design?, channel?, asker?}, and read back a stream of events,
// one JSON object per line (NDJSON), as they happen:
//   queued → start → the router's step → your code's search or read → model steps (and the
//   answer's words, on the routes that stream) → done
// It's the assistant's third front end, after Slack (bot.ts) and the terminal (eval.ts).
//
// Run:  npx tsx m09-web/server.ts
//       curl -N -X POST http://127.0.0.1:3001/ask -H 'Content-Type: application/json' -d @m09-web/question.json
// Options:  --port 3001, --model, --profile   as in Module 6

import { createServer, type IncomingMessage } from "node:http";
import { parseArgs } from "node:util";
import { pickTarget } from "../common/llm";
import type { AgentEvent } from "../m06-agents/agent-loop";
import { printEvent } from "../m06-agents/cli";
import { createAssistant, modelCallsOf, pickDesign, secondsOf, type Design } from "../m08-slack/assistant";
import { checkQuestion, removeSecrets } from "../m08-slack/guardrails";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "3001" },
    model: { type: "string" },
    profile: { type: "string" },
  },
});
const target = pickTarget(values);
const assistant = await createAssistant({ target });

// One question at a time, as in bot.ts: two runs would share your CPU and both get slower.
// (bot.ts has its own line. Run both, and they don't know about each other: exercise 2.)
let line: Promise<unknown> = Promise.resolve();
let pending = 0;

function inLine<T>(job: () => Promise<T>): Promise<T> {
  pending++;
  const run = line.then(job).finally(() => pending--);
  line = run.catch(() => {});
  return run;
}

// ─── The request ─────────────────────────────────────────────────────────────

type Ask = { question: string; design: Design; channel?: string; asker?: string };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

async function readAsk(request: IncomingMessage): Promise<Ask> {
  let body = "";
  for await (const chunk of request) body += chunk;
  const json = JSON.parse(body || "{}") as Record<string, unknown>;
  return {
    question: text(json.question) ?? "",
    design: pickDesign(text(json.design)), // throws on an unknown design: a 400 below
    channel: text(json.channel)?.replace(/^#/, ""),
    asker: text(json.asker),
  };
}

// ─── The events, as they go over the wire ────────────────────────────────────

// The same events bot.ts prints and log.ts records, made small for the browser: a search
// returns ~2,000 characters, and the page only needs a preview. `byCode` marks the calls your
// code made (search first, read first, search again), as opposed to the model's.
function toWire(event: AgentEvent) {
  if (event.kind === "model") {
    const { step, tokensIn, tokensOut, seconds } = event;
    return { type: "step", step, tokensIn, tokensOut, seconds, text: event.text.slice(0, 300), calls: event.calls.map((c) => `${c.name} ${c.arguments}`) };
  }
  if (event.kind === "tool") {
    const { name, arguments: args } = event.call;
    const byCode = event.byCode === true;
    return { type: "tool", name, arguments: args, byCode, characters: event.result.length, preview: event.result.slice(0, 300), seconds: event.seconds };
  }
  return { type: "note", text: event.text };
}

// ─── The server ──────────────────────────────────────────────────────────────

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/ask") {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Only POST /ask\n");
    return;
  }
  const ask = await readAsk(request).catch((error: Error) => error);
  if (ask instanceof Error) {
    response.writeHead(400, { "Content-Type": "text/plain" }).end(`${ask.message}\n`);
    return;
  }

  // From here on, the answer is a stream: headers now, then one line per event.
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
  const send = (event: object) => response.write(`${JSON.stringify(event)}\n`);

  const refusal = checkQuestion(ask.question);
  if (refusal) {
    send({ type: "done", answer: refusal, sources: [], route: null, modelCalls: 0, seconds: 0 });
    response.end();
    return;
  }

  send({ type: "queued", ahead: pending });
  await inLine(async () => {
    send({ type: "start" });
    console.log(`\n════ web · ${ask.design}: ${ask.question}`);
    try {
      const reply = await assistant.ask(
        ask.question,
        { channel: ask.channel, asker: ask.asker, via: "the web UI" },
        (event) => {
          printEvent(event);
          send(toWire(event));
        },
        {
          design: ask.design,
          onToken: (piece) => send({ type: "token", text: piece }),
          // search-again: the "I don't know" that just streamed is being replaced by a second answer.
          onDiscard: () => send({ type: "discard" }),
        },
      );
      // The words already streamed unchecked. The final answer goes through the output
      // guardrail and replaces them on the page (lesson 9.2's secret test).
      send({
        type: "done",
        answer: reply.answer === null ? null : removeSecrets(reply.answer),
        sources: reply.sources,
        route: reply.route?.name ?? null,
        modelCalls: modelCallsOf(reply),
        seconds: secondsOf(reply),
      });
    } catch (error) {
      console.error(error);
      send({ type: "error", message: "The assistant failed on this question. The details are in its terminal." });
    }
  });
  response.end();
});

// 127.0.0.1 only: the web app reaches it, nothing else on your network does.
server.listen(Number(values.port), "127.0.0.1", () => {
  console.log(`\nThe assistant is listening on http://127.0.0.1:${values.port}/ask (model ${target.model}).`);
  console.log(`Servers: ${assistant.servers.join(", ")} · default design: ${assistant.design}`);
  console.log("Start the web app in another terminal (lesson 9.2). Ctrl+C to stop.");
});

process.on("SIGINT", async () => {
  await assistant.close(); // stops the MCP servers
  server.close();
  process.exit(0);
});
