# Module 7 checkpoint: answers

Reference answers to the [checkpoint](README.md#checkpoint-answer-in-your-own-words), using the sessions in [Reference results](README.md#reference-results). This file isn't part of the search corpus (only `README.md` is), so it can quote the tasks and their answers.

## 1. What problem does MCP solve? Explain it with the M×N picture and the hosts and servers you used.

Every AI app needs the same tools and data, and without a standard each app–tool pair needs its own integration: M apps × N tools. Module 6 was an example. Your `tools.ts` worked only inside your agent. Claude Code couldn't use it, and your agent couldn't use Claude Code's file tools.

With one protocol, each tool is written once as a server and each app implements a client once: M + N. In this module:
- **One server, three hosts.** `notes-server.ts` was used by the Inspector, Claude Code and `mcp-agent.ts`, without changing a line.
- **One host, three servers.** `mcp-agent.ts` used your notes server, your hand-written `raw-server.ts`, and the filesystem server, which somebody else wrote. The glue is `connect()` in `mcp-tools.ts`, about 40 lines, and it works for any server.

The Language Server Protocol did the same for editors and programming languages, and MCP borrows its design.

## 2. In lessons 7.3 and 7.4, which program is the host, which is the client and which is the server? Which of them talks to the model?

| | Lesson 7.3 | Lesson 7.4 |
|---|---|---|
| **Host** (owns the conversation and the model) | Claude Code | `mcp-agent.ts`: your Module 6 loop, `runAgent` |
| **Client** (one connection per server, inside the host) | Claude Code's connection to `notes` | the SDK's `Client` + `StdioClientTransport`, created in `connect()` |
| **Server** (a separate process the host starts) | `notes-server.ts`, started with the absolute `tsx` path from `claude mcp add` | `notes-server.ts`, `raw-server.ts`, or `@modelcontextprotocol/server-filesystem` |
| **Model** | Claude (Opus 5.5) at Anthropic | Qwen3 4B in Ollama |

**Only the host talks to the model.** The model never speaks MCP. It sees ordinary tool definitions: Claude saw `mcp__notes__search_notes`, and Qwen saw `search_notes` in Ollama's `tools` field. When the model asks for a tool, the host sends `tools/call` through the client and gives the result back to the model as a tool message. The server never calls a model either. Even the `quiz` prompt only returns messages.

## 3. Tool, resource, prompt: who decides when each one is used? Give an example of each from `notes-server.ts`.

| Primitive | Who decides | In `notes-server.ts` | What you saw |
|---|---|---|---|
| **Tool** | the model | `search_notes` | Claude chose when to call it and what to search for. Asked without instructions, it chose `grep` instead and never called your tool |
| **Resource** | the app or the user | `notes://m05-rag/README.md`, one per document | You attach one with `@` in Claude Code. In exercise 5, your code puts one in the system prompt |
| **Prompt** | the user | `quiz` | It became the slash command `/mcp__notes__quiz`. It returns messages, and the host sends them |

**The difference between a tool and a resource** (the course checkpoint):
- A **tool** is an action. The model calls it with arguments, it runs when called, and it may have side effects.
- A **resource** is content with an address (a URI). The application or the user decides whether to put it in the context. The model doesn't ask for it.

The same notes appear both ways:
- `search_notes` is retrieval the model drives;
- the `notes://` resources are context you choose.

**The host decides how a primitive is shown.** Claude Code split the prompt's arguments on spaces. It also passed an `@` mention inside those arguments through as plain text. The same server could behave differently in another host.

## 4. Walk through the messages from starting a stdio server to getting a tool's result. What does the handshake negotiate?

1. **The host starts the server** as a child process (`tsx notes-server.ts`) and holds its stdin and stdout. One JSON-RPC message per line. Logs go to stderr.
2. **→ `initialize`** (a request, id 1): the protocol version the client speaks (`2025-06-18` in `hello.jsonl`), its capabilities and its name.
3. **← the result for id 1:** the version the server picked, its capabilities and its name. `raw-server.ts` declared `{ tools: {} }`. `notes-server.ts` also declared resources and prompts.
4. **→ `notifications/initialized`:** a notification. It has no id and gets no reply, which is why `hello.jsonl`'s second line got no answer.
5. **→ `tools/list`** (id 2) **←** the tools: name, description, `inputSchema`. The host turns them into the model's tool definitions.
6. The model asks for a tool. **→ `tools/call`** (id 3) with `name` and `arguments`. **←** `{ content: [{ type: "text", text }], isError? }`.
7. The host gives the text to the model and calls the model again.

**What the handshake negotiates:**
- **The protocol version:** the newest one both sides speak.
- **Capabilities:** which features each side supports. Afterwards, neither side uses a feature the other didn't declare. That's why #6, `resources/list`, failed against `raw-server.ts`: it declared tools only, so the method doesn't exist there.

It works in both directions. Your client declared no capabilities, so the filesystem server logged `Client does not support MCP Roots`. Roots are the folders a user allows. With none declared, the server fell back to the folder on its command line.

**Two kinds of failure, for two readers:**
- **#4 (`1,000 * 3`):** the tool ran and failed. It's a normal result with `isError: true`, written for the model to read and recover from.
- **#5 (an unknown tool) and #6 (an undeclared method):** JSON-RPC `error`s, written for the host.

## 5. Why is MCP a protocol rather than a library? What did your hand-written server prove?

**A library** is code you load into your own program. It's in one language, runs in your process, and its contract is the functions it exports.

**A protocol** is a format for messages over a transport. Any program, in any language, can speak it. The contract is the messages, not the code.

**What `raw-server.ts` proved.** About 90 lines with no SDK, only `readline` and `JSON.stringify`, worked with:
- the Inspector, a web app;
- the SDK's `Client` (`mcp-agent.ts --server raw`);
- and it would work with Claude Code too.

None of them shares a line of code with it. The SDK is one convenient implementation of the protocol, not the protocol itself. The filesystem server is the same idea from the other side: you didn't read its code, you only spoke to it.

**Why the separation matters:**
- **Hosts and servers stay separate.** Each server is a separate process, with its own language, version and release cycle. A host can't call a server's functions, only send it messages. The servers in this module happened to be Node, but a Python server would plug in the same way.
- **The spec carries a version.** `VERSIONS` in `raw-server.ts` lists several. The handshake picks one, so old clients and new servers can still talk.

## 6. You add a third-party MCP server. What are you trusting, and what would you check or limit first?

**What you're trusting:**
- **Its code.** A stdio server runs as you. It can read `~/.ssh`, your `.env` and your browser profile, and it can use the network.
- **Its tool descriptions.** They go straight into your model's prompt, so a description can carry hidden instructions (tool poisoning, exercise 4).
- **Its next version.** `npx -y some-server` runs whatever was published today, so the code and the descriptions can change after you've checked them.
- **Its own claims.** `readOnlyHint` annotations and "only this folder" checks are enforced by the server's code, not by the protocol.
- **Its publisher and its dependencies.** It's a supply chain.

**What to check or limit first:**
1. **Who publishes it, and pin the version** (`@modelcontextprotocol/server-filesystem@2.1.0`, not the latest).
2. **Read its tool list and descriptions before the model does** (`--show-tools`). The filesystem server 2.1.0 offers 14 tools. 4 of them change files: `write_file`, `edit_file`, `create_directory`, `move_file`.
3. **Expose only the tools the task needs.** Lesson 7.4's rerun used `--tools list_allowed_directories,list_directory,read_text_file`, not all 14. Fewer tools also means fewer prompt tokens and fewer wrong choices for a 4B model. All 14 definitions took 1,938 tokens on t03's first step, against 532 for Module 6's five tools, and that step alone took 55 s. With three tools, the same step took 535 tokens and 16 s. In that run, though, the model announced a tool call instead of making one. A smaller tool list changes the model's decisions too, so measure it with an eval rather than one run.
4. **Check what's missing, too.** The filesystem server has no calculator, so on t03 the model picked the right rows and then added them in its head, wrongly. A server's tool list decides what the model has to do unaided.
5. **Narrow what it can reach:**
   - give it one folder, not your home folder;
   - pass only the environment variables it needs. `StdioClientTransport` passes only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` unless you add more.
6. **Keep a human in front of every write.** Claude Code asks before a tool call. Your agent doesn't, so keep write tools out of it.
7. **For stronger isolation,** run the server in a container, or use a remote server whose token has narrow scopes.
