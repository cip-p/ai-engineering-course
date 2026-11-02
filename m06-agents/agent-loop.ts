// Lesson 6.2: an agent with native tool calling. The loop:
//   1. send the conversation, plus the tool definitions, to the model;
//   2. if it asks for tools, run them, add their results to the conversation, and go back to 1;
//   3. if it replies without asking for a tool, that reply is the final answer.
// A step limit stops it if it never gets to 3.

import type OpenAI from "openai";
import { local, system, user, type Target } from "../common/llm";
import { INSTRUCTIONS, runTool, TOOLS, type Tool } from "./tools";

export type ToolCall = { name: string; arguments: string }; // arguments: the JSON text the model wrote

// What happened, step by step: the trace printer shows these as they happen.
export type AgentEvent =
  | {
      kind: "model";
      step: number;
      text: string; // what the model wrote, besides any tool calls
      calls: ToolCall[];
      madeUp?: string; // lesson 6.1 only: a tool result the model wrote itself
      tokensIn: number;
      tokensOut: number;
      seconds: number;
    }
  | { kind: "tool"; call: ToolCall; result: string; seconds: number; byCode?: true } // byCode (Module 8): your code called it, not the model
  | { kind: "note"; text: string };

export type AgentOptions = {
  target?: Target;
  tools?: Tool[];
  instructions?: string; // the system prompt (default: INSTRUCTIONS). Module 8's assistant has its own
  maxSteps?: number; // the most model calls before giving up
  onEvent?: (event: AgentEvent) => void;
};

export type AgentResult = {
  answer: string | null; // null when it hit the step limit
  stoppedBy: "answer" | "step limit";
  modelCalls: number;
  toolCalls: (ToolCall & { result: string })[];
  formatErrors: number; // lesson 6.1 only: replies the parser couldn't read
  seconds: number;
};

// The tool definitions in the API's format. Ollama puts them into the prompt for the
// model, using the tool-calling layout its chat template was trained on.
export const toolDefinitions = (tools: Tool[]): OpenAI.Chat.ChatCompletionTool[] =>
  tools.map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

export async function runAgent(task: string, options: AgentOptions = {}): Promise<AgentResult> {
  const { target = local, tools = TOOLS, instructions = INSTRUCTIONS, maxSteps = 8, onEvent = () => {} } = options;
  const start = performance.now();
  const toolCalls: AgentResult["toolCalls"] = [];
  const finish = (answer: string | null, stoppedBy: AgentResult["stoppedBy"], modelCalls: number): AgentResult => ({
    answer,
    stoppedBy,
    modelCalls,
    toolCalls,
    formatErrors: 0,
    seconds: (performance.now() - start) / 1000,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [system(instructions), user(task)];

  for (let step = 1; step <= maxSteps; step++) {
    const stepStart = performance.now();
    const completion = await target.llm.chat.completions.create({
      model: target.model,
      messages,
      tools: toolDefinitions(tools),
      temperature: 0,
    });
    const message = completion.choices[0].message;

    // The model wrote its tool calls as text; the server (Ollama) parsed them out of it
    // and returns them as JSON. Each one gets an id, so its result can refer back to it.
    const calls = (message.tool_calls ?? []).flatMap((call) =>
      call.type === "function" ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }] : [],
    );
    onEvent({
      kind: "model",
      step,
      text: message.content?.trim() ?? "",
      calls,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      seconds: (performance.now() - stepStart) / 1000,
    });

    // No tool call: the model is done, and its text is the answer.
    if (calls.length === 0) return finish(message.content?.trim() ?? "", "answer", step);

    // Keep the model's request in the conversation, then answer each call with a "tool" message.
    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });
    for (const call of calls) {
      const toolStart = performance.now();
      const result = await runTool(tools, call.name, call.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
      toolCalls.push({ name: call.name, arguments: call.arguments, result });
      onEvent({ kind: "tool", call, result, seconds: (performance.now() - toolStart) / 1000 });
    }
  }
  return finish(null, "step limit", maxSteps);
}
