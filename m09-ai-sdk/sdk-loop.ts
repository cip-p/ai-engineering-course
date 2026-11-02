// Module 9 (framework), lesson 9.3: Module 6's agent loop (m06-agents/agent-loop.ts), rebuilt
// with the AI SDK's ToolLoopAgent. Same task in, the same AgentResult out, and the same trace
// events along the way, so Module 6's printer and eval work with either loop. Read the two
// files side by side: what you wrote by hand there is a setting here.

import { isStepCount, jsonSchema, tool, ToolLoopAgent, type JSONSchema7, type ToolSet } from "ai";
import type { Endpoint } from "../common/llm";
import type { AgentEvent, AgentResult, ToolCall } from "../m06-agents/agent-loop";
import { INSTRUCTIONS, runTool, type Tool } from "../m06-agents/tools";
import { sdkModel } from "./model";

export type SdkAgentOptions = {
  endpoint: Endpoint;
  tools: ToolSet;
  instructions?: string;
  maxSteps?: number; // the most model calls, as in Module 6
  onEvent?: (event: AgentEvent) => void;
  showRequests?: boolean;
};

// Module 6's tools as AI SDK tools. Their definitions are JSON Schema already, so jsonSchema()
// takes them as they are, and runTool keeps Module 6's "Error: …" results for the model.
export function toSdkTools(tools: Tool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        // Module 6's Tool type writes "type" as any string; the SDK's JSON Schema type is stricter.
        inputSchema: jsonSchema<Record<string, unknown>>(t.parameters as unknown as JSONSchema7),
        execute: (args) => runTool([t], t.name, JSON.stringify(args)),
      }),
    ]),
  );
}

// A tool's output as text. Module 6's tools return strings; an MCP tool returns the server's
// result, { content: [{ type: "text", text }] } (Module 7).
export function textOf(output: unknown): string {
  if (typeof output === "string") return output;
  const content = (output as { content?: { type: string; text?: string }[] } | null)?.content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? `[${part.type} content]`).join("\n");
  return JSON.stringify(output);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runSdkAgent(task: string, options: SdkAgentOptions): Promise<AgentResult> {
  const { endpoint, tools, instructions = INSTRUCTIONS, maxSteps = 8, onEvent = () => {}, showRequests = false } = options;
  const start = performance.now();
  const toolCalls: AgentResult["toolCalls"] = [];
  let ranThisStep: AgentEvent[] = [];

  const agent = new ToolLoopAgent({
    model: sdkModel(endpoint, { showRequests }),
    instructions,
    tools,
    temperature: 0, // the SDK leaves it to the provider; Module 6 always sent 0
    stopWhen: isStepCount(maxSteps), // the SDK's own default is 20 steps

    // The SDK runs a step's tools before it reports the step itself. So keep each tool's
    // result here, and print it after the model's line, in Module 6's order.
    onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
      const call: ToolCall = { name: toolCall.toolName, arguments: JSON.stringify(toolCall.input) };
      const result = toolOutput.type === "tool-result" ? textOf(toolOutput.output) : `Error: ${messageOf(toolOutput.error)}`;
      toolCalls.push({ ...call, result });
      ranThisStep.push({ kind: "tool", call, result, seconds: toolExecutionMs / 1000 });
    },
    onStepEnd: ({ stepNumber, text, toolCalls: calls, usage, performance: timing }) => {
      onEvent({
        kind: "model",
        step: stepNumber + 1, // the SDK counts steps from 0
        text: text.trim(),
        calls: calls.map((c) => ({ name: c.toolName, arguments: JSON.stringify(c.input) })),
        tokensIn: usage.inputTokens ?? 0,
        tokensOut: usage.outputTokens ?? 0,
        seconds: timing.responseTimeMs / 1000,
      });
      for (const event of ranThisStep) onEvent(event);
      ranThisStep = [];
    },
  });

  const result = await agent.generate({ prompt: task });

  // A loop that ended with a tool call still waiting can only have hit the step limit.
  const limited = result.finishReason === "tool-calls";
  return {
    answer: limited ? null : result.text.trim(),
    stoppedBy: limited ? "step limit" : "answer",
    modelCalls: result.steps.length,
    toolCalls,
    formatErrors: 0,
    seconds: (performance.now() - start) / 1000,
  };
}
