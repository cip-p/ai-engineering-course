// A stand-in for a busy provider: an HTTP proxy in front of a real OpenAI-compatible
// server (your Ollama by default) that turns some requests away. It follows a fixed
// schedule, so every run behaves the same way, and you can't run up a bill testing it.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Endpoint } from "../common/llm";

// What the proxy does with each request it receives, in order. After the last one it starts again.
//   ok    forward it, and return the real answer
//   429   "Too Many Requests", with Retry-After: 1 (wait a second, then try again)
//   503   "Service Unavailable": the server is overloaded, no hint when to come back
//   slow  wait 12 seconds, then forward it: longer than a client willing to wait 10 s
export type Behaviour = "ok" | "429" | "503" | "slow";
export const SCHEDULE: Behaviour[] = ["ok", "429", "429", "ok", "503", "ok", "slow", "ok"];

export type Logged = { attempt: number; behaviour: Behaviour; at: number; status?: number; abandoned?: boolean };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (piece) => (body += piece));
    req.on("end", () => resolve(body));
  });

export async function startFlakyProxy(upstream: Endpoint, schedule: Behaviour[] = SCHEDULE) {
  let attempts = 0;
  const log: Logged[] = [];

  const server = createServer(async (req, res) => {
    attempts++;
    const entry: Logged = { attempt: attempts, behaviour: schedule[(attempts - 1) % schedule.length], at: performance.now() };
    log.push(entry);
    let gaveUp = false; // the client closed the connection before getting its answer
    res.on("close", () => (gaveUp ||= !res.writableFinished));
    const body = await readBody(req);
    const reply = (status: number, headers: Record<string, string>, text: string) => {
      entry.status = status;
      if (gaveUp) return;
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(text);
    };

    if (entry.behaviour === "429") return reply(429, { "Retry-After": "1" }, JSON.stringify({ error: { message: "Rate limit reached. Try again in 1 second." } }));
    if (entry.behaviour === "503") return reply(503, {}, JSON.stringify({ error: { message: "The server is overloaded." } }));
    if (entry.behaviour === "slow") await new Promise((resolve) => setTimeout(resolve, 12_000));

    // A request the client has abandoned still runs upstream: a real provider would still bill it.
    if (gaveUp) entry.abandoned = true;
    const response = await fetch(`${upstream.baseURL}${req.url!.replace(/^\/v1/, "")}`, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstream.apiKey}` },
      body: req.method === "GET" ? undefined : body,
    });
    reply(response.status, {}, await response.text());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    log,
    reset: () => {
      attempts = 0;
      log.length = 0;
    },
    // Drop any request it's still holding ("slow"), then stop.
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
