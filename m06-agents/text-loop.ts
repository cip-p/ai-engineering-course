// Lesson 6.1: a ReAct agent with NO tool-calling API. The tools are described in plain
// text, the model writes "Action: …" lines, and a regular expression finds them. Native
// tool calling (lesson 6.2) works the same way underneath, with a format the model was
// trained on and a server that does the parsing for you.

import type OpenAI from "openai";
import { assistant, local, system, user } from "../common/llm";
import type { AgentOptions, AgentResult, ToolCall } from "./agent-loop";
import { INSTRUCTIONS, runTool, TOOLS, type Tool } from "./tools";

// ReAct: reason (Thought), act (Action), observe (Observation), repeat.
const FORMAT = `Use exactly this format:

Thought: what you need to do next
Action: the name of one tool
Action Input: the tool's arguments, as a JSON object
Observation: the tool's result

The system writes every Observation, never you. Thought, Action, Action Input and Observation can repeat. When you know the answer, write:

Thought: I know the answer
Final Answer: the answer`;

// e.g. `- calculator: Evaluate an arithmetic expression … Arguments: {"expression": string}`
const describe = (tool: Tool) => {
  const args = Object.entries(tool.parameters.properties).map(([name, property]) => `"${name}": ${property.type}`);
  return `- ${tool.name}: ${tool.description} Arguments: {${args.join(", ")}}`;
};

// The whole protocol is this prompt plus the regular expressions below.
export const textAgentPrompt = (tools: Tool[]) => `${INSTRUCTIONS}\n\nTools:\n${tools.map(describe).join("\n")}\n\n${FORMAT}`;

// stop: false turns off the stop sequence, to see what it prevents.
export async function runTextAgent(task: string, options: AgentOptions & { stop?: boolean } = {}): Promise<AgentResult> {
  const { target = local, tools = TOOLS, maxSteps = 8, onEvent = () => {}, stop = true } = options;
  const start = performance.now();
  const toolCalls: AgentResult["toolCalls"] = [];
  let formatErrors = 0;
  const finish = (answer: string | null, stoppedBy: AgentResult["stoppedBy"], modelCalls: number): AgentResult => ({
    answer,
    stoppedBy,
    modelCalls,
    toolCalls,
    formatErrors,
    seconds: (performance.now() - start) / 1000,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [system(textAgentPrompt(tools)), user(`Question: ${task}`)];

  for (let step = 1; step <= maxSteps; step++) {
    const stepStart = performance.now();
    const completion = await target.llm.chat.completions.create({
      model: target.model,
      messages,
      temperature: 0,
      // Generation stops as soon as the model starts writing "Observation:". Otherwise it
      // would carry on and write the tool's result itself: a made-up one.
      stop: stop ? ["Observation:"] : undefined,
    });
    let text = completion.choices[0].message.content ?? "";

    // Without the stop sequence, cut off any observation the model wrote itself, and keep
    // it only to show in the trace. The real tool still runs.
    let madeUp: string | undefined;
    const observationAt = text.indexOf("Observation:");
    if (observationAt >= 0) {
      madeUp = text.slice(observationAt).trim();
      text = text.slice(0, observationAt);
    }
    text = text.trim();

    // The parser. Everything a tool-calling API does for you, done by hand.
    const action = text.match(/Action:\s*(.+?)\s*\n\s*Action Input:\s*([\s\S]*)/);
    const final = text.match(/Final Answer:\s*([\s\S]*)/);
    let call: ToolCall | undefined;
    if (action && (!final || action.index! < final.index!)) {
      // Small models like to wrap JSON in ``` fences. Free text needs this kind of patching.
      call = { name: action[1], arguments: action[2].replace(/^```(?:json)?\s*|\s*```$/g, "").trim() };
    }

    onEvent({
      kind: "model",
      step,
      text,
      calls: call ? [call] : [],
      madeUp,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      seconds: (performance.now() - stepStart) / 1000,
    });

    if (!call && final) return finish(final[1].trim(), "answer", step);

    // Not done yet: put the model's text back into the conversation, followed by the
    // observation, so it can continue from there.
    messages.push(assistant(text));
    let observation: string;
    if (call) {
      const toolStart = performance.now();
      observation = await runTool(tools, call.name, call.arguments);
      toolCalls.push({ ...call, result: observation });
      onEvent({ kind: "tool", call, result: observation, seconds: (performance.now() - toolStart) / 1000 });
    } else {
      formatErrors++;
      observation = "Error: I found no Action and no Final Answer. Follow the format.";
      onEvent({ kind: "note", text: "the parser found no Action and no Final Answer: format error" });
    }
    messages.push(user(`Observation: ${observation}`));
  }
  return finish(null, "step limit", maxSteps);
}
