// Lesson 6.2: the tools. A tool has two halves:
//   - a definition the model reads: a name, a description, and its arguments as a JSON Schema;
//   - a function YOUR code runs when the model asks for it.
// The model never runs anything. It writes a request, and your code decides what happens.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRetriever, type Retriever } from "../m05-rag/retrieve";

export type Tool = {
  name: string;
  description: string; // the model picks tools by their descriptions, so write them for the model
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  run: (args: Record<string, unknown>) => string | Promise<string>;
};

// The instructions both agents start from. Lesson 6.1 adds its text format to them.
export const INSTRUCTIONS =
  "You are a helpful assistant with tools. Use a tool whenever it is more reliable than your memory: " +
  "arithmetic, the current date, the user's files, the user's course notes. " +
  "When you have the answer, give it in one or two sentences.";

// The only folder the file tools can see.
export const SANDBOX = fileURLToPath(new URL("./sandbox", import.meta.url));

// The arguments come from the model, so check them like any other untrusted input.
function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`"${name}" must be a non-empty string`);
  return value;
}

// ─── calculator ──────────────────────────────────────────────────────────────

const calculator: Tool = {
  name: "calculator",
  description:
    "Evaluate an arithmetic expression with + - * / ^ and parentheses, e.g. (12.5 + 30) * 4. " +
    "Use plain numbers only: no commas, units or % signs.",
  parameters: {
    type: "object",
    properties: { expression: { type: "string", description: "The expression to evaluate" } },
    required: ["expression"],
  },
  run: (args) => String(calculate(stringArg(args, "expression"))),
};

// A tiny arithmetic parser. Never eval() what a model wrote: eval runs ANY JavaScript,
// and the model's output can be steered by whatever text it has read (prompt injection).
export function calculate(expression: string): number {
  const tokens = expression.match(/\d*\.?\d+|\S/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  // Each function handles one level of precedence: + and - bind loosest, then * and /,
  // then ^ and a leading minus, then numbers and parentheses.
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") value = take() === "+" ? value + product() : value - product();
    return value;
  };
  const product = (): number => {
    let value = power();
    while (peek() === "*" || peek() === "/") value = take() === "*" ? value * power() : value / power();
    return value;
  };
  const power = (): number => {
    if (peek() === "-") {
      take();
      return -power();
    }
    const base = atom();
    if (peek() !== "^") return base;
    take();
    return base ** power();
  };
  const atom = (): number => {
    const token = take();
    if (token === "(") {
      const value = sum();
      if (take() !== ")") throw new Error('missing ")"');
      return value;
    }
    if (token !== undefined && /\d/.test(token)) return Number(token);
    throw new Error(token === undefined ? "the expression ends too early" : `unexpected "${token}"`);
  };

  const value = sum();
  if (position < tokens.length) throw new Error(`unexpected "${peek()}"`);
  if (!Number.isFinite(value)) throw new Error("the result isn't a finite number (division by zero?)");
  return Number(value.toPrecision(12)); // 0.1 + 0.2 gives 0.3, not 0.30000000000000004
}

// ─── current_time ────────────────────────────────────────────────────────────

const currentTime: Tool = {
  name: "current_time",
  description: "Get the current date, weekday, time and time zone. You cannot know these from memory.",
  parameters: { type: "object", properties: {}, required: [] },
  run: () => {
    const now = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
    return `${now} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  },
};

// ─── list_files and read_file: read-only, and only inside the sandbox ────────

const listFiles: Tool = {
  name: "list_files",
  description: "List the user's files, with their sizes.",
  parameters: { type: "object", properties: {}, required: [] },
  run: () =>
    (readdirSync(SANDBOX, { recursive: true }) as string[])
      .filter((path) => !basename(path).startsWith(".") && statSync(resolve(SANDBOX, path)).isFile())
      .sort()
      // "/" on every OS: a Windows backslash would have to be escaped in the model's JSON arguments.
      .map((path) => `${path.split(sep).join("/")} (${statSync(resolve(SANDBOX, path)).size} bytes)`)
      .join("\n"),
};

const MAX_CHARACTERS = 4000;

const readFile: Tool = {
  name: "read_file",
  description: "Read one of the user's files. Use the path exactly as list_files shows it.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "The file's path, as list_files shows it" } },
    required: ["path"],
  },
  run: (args) => {
    const path = stringArg(args, "path");
    // The guard. Resolve the path first ("a/../../x" becomes a real location), then refuse
    // anything outside the sandbox: "../../.env", "/etc/passwd". Your code enforces this,
    // whatever the model was told or tricked into asking for.
    const full = resolve(SANDBOX, path);
    if (!full.startsWith(SANDBOX + sep)) throw new Error(`access denied: "${path}" is outside the user's folder`);
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`there is no file "${path}". Use list_files to see what exists`);

    const text = readFileSync(full, "utf8");
    return text.length > MAX_CHARACTERS ? `${text.slice(0, MAX_CHARACTERS)}\n[… cut at ${MAX_CHARACTERS} characters]` : text;
  },
};

// ─── search_notes: Module 5's retrieval as a tool ────────────────────────────

let notes: Promise<Retriever> | undefined; // built on the first search, so other tasks don't wait for it

const searchNotes: Tool = {
  name: "search_notes",
  description:
    "Search the user's AI engineering course notes: lessons, exercises and their measured results. " +
    "Returns the 3 most relevant passages. Write the query in the words the notes would use.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to search for" } },
    required: ["query"],
  },
  run: async (args) => {
    const query = stringArg(args, "query");
    notes ??= createRetriever({ chunkSize: 800 }); // Module 5's choice: 800-character chunks
    const { hits } = await (await notes).search(query, 3);
    return hits.map((hit, i) => `[${i + 1}] ${hit.chunk.id}\n${hit.chunk.text}`).join("\n\n");
  },
};

// ─── All tools, and running one ──────────────────────────────────────────────

export const TOOLS: Tool[] = [calculator, currentTime, listFiles, readFile, searchNotes];

// Pick tools by name, e.g. "calculator,read_file". No names means all of them. Module 7
// passes its own list (`from`): the tools an MCP server offers.
export function pickTools(names?: string, from: Tool[] = TOOLS): Tool[] {
  if (!names) return from;
  return names.split(",").map((name) => {
    const tool = from.find((t) => t.name === name.trim());
    if (!tool) throw new Error(`No tool named "${name}". Tools: ${from.map((t) => t.name).join(", ")}`);
    return tool;
  });
}

// Run a tool call exactly as the model wrote it. Every problem becomes an "Error: …"
// result instead of a crash, so the model can read what went wrong and try again.
export async function runTool(tools: Tool[], name: string, argumentsJson: string): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Error: there is no tool called "${name}". Tools: ${tools.map((t) => t.name).join(", ")}`;

  let args: unknown;
  try {
    args = JSON.parse(argumentsJson.trim() || "{}");
  } catch {
    return `Error: the arguments aren't valid JSON: ${argumentsJson}`;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "Error: the arguments must be a JSON object";

  try {
    return await tool.run(args as Record<string, unknown>);
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
