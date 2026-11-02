// The browser talks only to this app. This route hands the question to the assistant service
// (m09-web/server.ts) and passes its events back as they arrive, without waiting for the end.
// The service listens on 127.0.0.1 only, so the browser never reaches it directly.

const ASSISTANT_URL = process.env.ASSISTANT_URL ?? "http://127.0.0.1:3001/ask";

export async function POST(request: Request) {
  let upstream: Response;
  try {
    upstream = await fetch(ASSISTANT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
  } catch {
    return new Response("The assistant service isn't running. Start it with: npx tsx m09-web/server.ts", { status: 502 });
  }
  // upstream.body is a stream: returning it as our body forwards each line as soon as it comes.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain", "Cache-Control": "no-cache, no-transform" },
  });
}
