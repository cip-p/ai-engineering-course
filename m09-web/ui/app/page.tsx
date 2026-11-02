"use client";

// Lesson 9.2: the chat page. It sends a question to /api/ask and reads the answer as a stream
// of events, one JSON object per line, updating the page as each one arrives. Under every
// answer, a bar shows where the time went, and the trace lists every event.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

// ─── What the assistant service sends (m09-web/server.ts) ────────────────────

type Wire =
  | { type: "queued"; ahead: number }
  | { type: "start" }
  | { type: "step"; step: number; tokensIn: number; tokensOut: number; seconds: number; text: string; calls: string[] }
  | { type: "tool"; name: string; arguments: string; byCode: boolean; characters: number; preview: string; seconds: number }
  | { type: "token"; text: string }
  | { type: "discard" } // the words so far weren't the final answer: your code is searching again
  | { type: "note"; text: string }
  | { type: "done"; answer: string | null; sources: string[]; route: string | null; modelCalls: number; seconds: number }
  | { type: "error"; message: string }
  | { type: "closed" }; // added by this page when the stream ends

type SegmentKind = "wait" | "router" | "code" | "tool" | "model" | "live";
type Segment = { kind: SegmentKind; label: string; seconds: number };

type Turn = {
  id: number;
  question: string;
  design: string;
  status: "waiting" | "working" | "done" | "failed";
  streamed: string; // the words as they arrived, before any check
  answer: string | null; // the final answer, after the service's output guardrail
  sources: string[];
  route: string | null;
  modelCalls?: number;
  trace: Wire[]; // every event except the words
  segments: Segment[]; // the finished parts of the timeline
  tokensOut?: number;
  sentAt: number;
  lastAt: number; // when the last part finished: the live part starts there
  startedAt?: number;
  firstWordAt?: number;
  doneAt?: number;
  error?: string;
};

const DESIGNS = ["search-again", "read-first", "router", "search-first", "agent", "agent-v1"];

// ─── One event at a time: the turn's next state ──────────────────────────────

function apply(turn: Turn, event: Wire, now: number): Turn {
  const traced = { ...turn, trace: [...turn.trace, event] };
  switch (event.type) {
    case "token":
      return { ...turn, status: "working", streamed: turn.streamed + event.text, firstWordAt: turn.firstWordAt ?? now };
    case "discard":
      // The first answer was "I don't know based on the notes". Clear it, and time the first word
      // of the answer that replaces it.
      return { ...traced, streamed: "", firstWordAt: undefined };
    case "start": {
      const waited = (now - turn.sentAt) / 1000;
      const segments: Segment[] = waited >= 0.5 ? [{ kind: "wait", label: "Waiting in line", seconds: waited }] : [];
      return { ...traced, status: "working", startedAt: now, lastAt: now, segments };
    }
    case "step": {
      const router = event.step === 0;
      const segment: Segment = router
        ? { kind: "router", label: event.text.replace(/^route → /, "Router chose "), seconds: event.seconds }
        : { kind: "model", label: `Model, step ${event.step}`, seconds: event.seconds };
      const tokensOut = router ? turn.tokensOut : event.tokensOut;
      return { ...traced, segments: [...turn.segments, segment], lastAt: now, tokensOut };
    }
    case "tool": {
      const label = event.byCode ? `Your code: ${event.name}` : `Model's tool: ${event.name}`;
      const segment: Segment = { kind: event.byCode ? "code" : "tool", label, seconds: event.seconds };
      return { ...traced, segments: [...turn.segments, segment], lastAt: now };
    }
    case "done":
      return { ...traced, status: "done", answer: event.answer, sources: event.sources, route: event.route, modelCalls: event.modelCalls, doneAt: now };
    case "error":
      return { ...traced, status: "failed", error: event.message, doneAt: now };
    case "closed":
      if (turn.status === "done" || turn.status === "failed") return turn;
      return { ...turn, status: "failed", error: "The stream ended before the answer did. Check the service's terminal.", doneAt: now };
    default:
      return traced;
  }
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [design, setDesign] = useState(DESIGNS[0]);
  const [channel, setChannel] = useState("study");
  const [asker, setAsker] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((turn) => turn.status === "waiting" || turn.status === "working");

  // The settings are remembered in this browser. Storage can be unavailable (a private
  // window, for example): then they start from the defaults.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("study-buddy") ?? "{}") as Record<string, unknown>;
      if (typeof saved.design === "string" && DESIGNS.includes(saved.design)) setDesign(saved.design);
      if (typeof saved.channel === "string") setChannel(saved.channel);
      if (typeof saved.asker === "string") setAsker(saved.asker);
    } catch {
      // Nothing saved, or no storage.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("study-buddy", JSON.stringify({ design, channel, asker }));
    } catch {
      // No storage: the settings last until the page reloads.
    }
  }, [design, channel, asker]);

  // While an answer is in progress, a clock ticks so the timeline's live part grows.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const update = (id: number, event: Wire) => {
    const at = Date.now();
    setTurns((all) => all.map((turn) => (turn.id === id ? apply(turn, event, at) : turn)));
  };

  async function ask(text: string) {
    const id = nextId.current++;
    const sentAt = Date.now();
    const turn: Turn = { id, question: text, design, status: "waiting", streamed: "", answer: null, sources: [], route: null, trace: [], segments: [], sentAt, lastAt: sentAt };
    setTurns((all) => [...all, turn]);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, design, channel, asker }),
      });
      if (!response.ok || !response.body) {
        update(id, { type: "error", message: (await response.text()) || `The request failed with status ${response.status}.` });
        return;
      }
      // The body arrives in pieces, as the service writes them, and a piece can end in the
      // middle of a line. So keep the unfinished end, and parse only complete lines.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) update(id, JSON.parse(line) as Wire);
      }
      update(id, { type: "closed" });
    } catch {
      update(id, { type: "error", message: "The connection to the assistant broke off. Is the service still running?" });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setQuestion("");
    void ask(text);
  }

  // Enter sends; Shift+Enter starts a new line.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1>Study Buddy</h1>
        <p className="lede">
          Answers from your course notes and your Slack channel, written by the model on your laptop. The bar under each
          answer shows where its time went.
        </p>
        <div className="settings">
          <label>
            Design
            <select value={design} onChange={(event) => setDesign(event.target.value)}>
              {DESIGNS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Slack channel
            <input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="study" />
          </label>
          <label>
            Your Slack name
            <input value={asker} onChange={(event) => setAsker(event.target.value)} placeholder="as Slack shows it" />
          </label>
        </div>
      </header>

      <section className="turns">
        {turns.length === 0 && (
          <p className="empty">
            Ask your first question below. On a laptop CPU the first word takes a while, and the bar under the answer
            will show you why.
          </p>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} now={now} />
        ))}
        <div ref={endRef} />
      </section>

      <form className="composer" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="question">
          Your question
        </label>
        <textarea
          id="question"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your notes or your channel"
        />
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? "Answering…" : "Ask"}
        </button>
      </form>
    </main>
  );
}

// ─── One question and its answer ─────────────────────────────────────────────

function TurnView({ turn, now }: { turn: Turn; now: number }) {
  const live = turn.status === "waiting" || turn.status === "working";
  const text = turn.answer ?? turn.streamed;
  // The service checks the final answer after the words have streamed (lesson 9.2's secret test).
  const changed = turn.answer !== null && turn.streamed !== "" && turn.answer !== turn.streamed.trim();

  const total = ((turn.doneAt ?? now) - turn.sentAt) / 1000;
  const firstWord = turn.firstWordAt ? (turn.firstWordAt - turn.sentAt) / 1000 : null;
  const writing = turn.firstWordAt && turn.doneAt ? (turn.doneAt - turn.firstWordAt) / 1000 : null;
  const speed = writing && turn.tokensOut ? turn.tokensOut / writing : null;

  const liveSegment: Segment | null = live
    ? { kind: turn.startedAt ? "live" : "wait", label: turn.startedAt ? "Working now" : "Waiting in line", seconds: (now - turn.lastAt) / 1000 }
    : null;

  return (
    <article className="turn">
      <p className="question">{turn.question}</p>

      <div className="answer" aria-busy={live}>
        {text || (live ? <span className="pending">{turn.startedAt ? "Thinking…" : "Waiting for the model…"}</span> : null)}
        {live && text && <span className="caret" aria-hidden="true" />}
      </div>
      {changed && <p className="note">The output check changed this answer after it streamed: what you saw while it was being written was replaced.</p>}
      {turn.error && <p className="error">{turn.error}</p>}

      {turn.sources.length > 0 && (
        <div className="sources">
          <h2>Sources</h2>
          <ul>
            {turn.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </div>
      )}

      <Timeline segments={liveSegment ? [...turn.segments, liveSegment] : turn.segments} live={live} />

      <p className="timing">
        {firstWord !== null
          ? `First word after ${firstWord.toFixed(1)} s. `
          : turn.status === "done"
            ? "This route doesn't stream: the answer arrived whole. "
            : ""}
        {`${live ? "So far" : "Total"} ${total.toFixed(1)} s.`}
        {speed !== null && ` Writing at ${speed.toFixed(1)} tokens per second.`}
        {turn.route && ` Route: ${turn.route}, ${turn.modelCalls} model calls.`}
      </p>

      <details className="trace">
        <summary>
          Trace of {turn.trace.length} events, design {turn.design}
        </summary>
        <ol>
          {turn.trace.map((event, i) => (
            <li key={i}>{describe(event)}</li>
          ))}
        </ol>
      </details>
    </article>
  );
}

// ─── The timeline: one coloured part per step, as wide as its share of the time ───

function Timeline({ segments, live }: { segments: Segment[]; live: boolean }) {
  if (segments.length === 0) return null;
  const summary = segments.map((s) => `${s.label}, ${s.seconds.toFixed(1)} seconds`).join("; ");
  return (
    <figure className="timeline">
      <div className="bar" role="img" aria-label={`Where the time went: ${summary}`}>
        {segments.map((segment, i) => (
          <span
            key={i}
            className={`segment segment-${segment.kind}${live && i === segments.length - 1 ? " is-live" : ""}`}
            style={{ flexGrow: Math.max(segment.seconds, 0.05) }}
            title={`${segment.label}: ${segment.seconds.toFixed(1)} s`}
          />
        ))}
      </div>
      <ol className="legend">
        {segments.map((segment, i) => (
          <li key={i}>
            <span className={`swatch segment-${segment.kind}`} aria-hidden="true" />
            {segment.label} <span className="seconds">{segment.seconds.toFixed(1)} s</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ─── The trace: every event, in the machine's words ──────────────────────────

const count = (n: number) => n.toLocaleString("en-GB");

function describe(event: Wire) {
  switch (event.type) {
    case "queued":
      return `queued, ${event.ahead} earlier question${event.ahead === 1 ? "" : "s"} ahead`;
    case "start":
      return "started";
    case "step":
      if (event.step === 0) return `router: ${event.text}, ${count(event.tokensIn)} tokens in, ${event.seconds.toFixed(1)} s`;
      return (
        <>
          model step {event.step}: {count(event.tokensIn)} tokens in, {count(event.tokensOut)} out, {event.seconds.toFixed(1)} s
          {event.calls.map((call) => (
            <div key={call}>calls {call}</div>
          ))}
        </>
      );
    case "tool":
      return (
        <>
          {event.byCode ? "your code called" : "the model called"} {event.name} {event.arguments}:{" "}
          {count(event.characters)} characters back, {event.seconds.toFixed(1)} s
          <pre>{event.preview}</pre>
        </>
      );
    case "done":
      return `done: route ${event.route ?? "none (no router)"}, ${event.modelCalls} model calls, ${event.seconds.toFixed(1)} s of work`;
    case "error":
      return `error: ${event.message}`;
    case "discard":
      return "the answer said it didn't know: discarded, and your code searches again";
    case "note":
      return event.text;
    default:
      return event.type;
  }
}
