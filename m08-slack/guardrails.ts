// Lesson 8.3: guardrails, in code. The prompt asks the model to behave; these make sure,
// whatever the model wrote or was tricked into writing.
// Checked by:  npx tsx --test m08-slack/guardrails.test.ts

// ─── Input ───────────────────────────────────────────────────────────────────

// On a CPU every character is prefill time, so the bot takes short questions only.
export const MAX_QUESTION = 500;

// The question inside a mention. Slack sends "<@U07ABC> what is BM25?", with &, < and >
// escaped as &amp; &lt; &gt;. The model should see what the person typed.
export function questionFrom(slackText: string): string {
  return slackText
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "") // mentions, the bot's included
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

// Whether the bot should work on this question: the reason to refuse, or null.
export function checkQuestion(question: string): string | null {
  if (!question) return "Ask me something about your course notes or this channel, e.g. `@study-buddy what is BM25?`";
  if (question.length > MAX_QUESTION) {
    return `That's ${question.length} characters, and I take up to ${MAX_QUESTION}: on a laptop CPU, long questions are slow. Could you shorten it?`;
  }
  return null;
}

// ─── Output ──────────────────────────────────────────────────────────────────

const MAX_ANSWER = 3000; // characters. Slack takes more, but nobody reads more in a thread

// Slack's markup is <…>: <@U07ABC> mentions a person, <!channel> notifies everyone in
// the channel, <https://evil.example|your notes> is a link that shows a false label.
// Escaping & < > turns all of it into plain text, so nothing the model writes can ping
// anyone or disguise a link. It's the same defense as HTML-escaping user input on a web page.
export const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Things that look like secrets: Slack, OpenAI-style and Hugging Face tokens. The agent
// has no tool that reads .env, but a token can still reach it, e.g. pasted in a channel.
const SECRET = /\b(xox[abposr]-[A-Za-z0-9-]{8,}|xapp-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})/g;

// Slack's formatting ("mrkdwn") isn't Markdown: bold is *one star*, and there are no headings.
const toSlackFormatting = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6} (.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)");

// Used on its own by the web UI (Module 9), where React does the escaping.
export const removeSecrets = (text: string) => text.replace(SECRET, "[secret removed]");

// The model's text, made safe to post.
export function cleanAnswer(text: string): string {
  const safe = toSlackFormatting(removeSecrets(escape(text)));
  return safe.length > MAX_ANSWER ? `${safe.slice(0, MAX_ANSWER)}… (cut)` : safe;
}
