// Module 9 (framework), lesson 9.6: Module 8's router (router v2), three ways, on the cases of
// m08-slack/cases.json that say where they should go:
//   yours:      Module 3's ask() with a JSON Schema, then JSON.parse and Zod, and "notes" as a fallback;
//   sdk choice: generateText with Output.choice, which validates the answer and throws if it's invalid;
//   sdk object: generateText with Output.object and your own Zod schema.
// The first run had only the first two. sdk choice scored 5/6: Output.choice makes the model write
// {"result": …}, where yours writes {"route": …}. The key is the last word the model reads before
// it picks, and on one case it flipped the decision. sdk object gives the SDK your key back.
//
// Run:  npx tsx m09-ai-sdk/sdk-router.ts
// Options:  --model, --profile

import { parseArgs } from "node:util";
import { generateText, Output } from "ai";
import { ask, pickEndpoint, pickTarget, system, user } from "../common/llm";
import { ROUTE_SCHEMA, RouteChoice, ROUTER_V2, ROUTES } from "../m08-slack/assistant";
import { loadCases } from "../m08-slack/cases";
import { sdkModel } from "./model";

const { values } = parseArgs({ options: { model: { type: "string" }, profile: { type: "string" } } });
const target = pickTarget(values);
const model = sdkModel(pickEndpoint(values));
const cases = loadCases().filter((c) => c.route);

async function timed<T>(run: () => Promise<T>): Promise<{ value: T | string; seconds: number }> {
  const start = performance.now();
  let value: T | string;
  try {
    value = await run();
  } catch (error) {
    value = `error: ${(error as Error).message.slice(0, 60)}`;
  }
  return { value, seconds: (performance.now() - start) / 1000 };
}

// Yours, as in m08-slack/assistant.ts.
async function yours(question: string) {
  const reply = await ask([system(ROUTER_V2), user(question)], { target, schema: ROUTE_SCHEMA, maxTokens: 20 });
  const choice = RouteChoice.safeParse(JSON.parse(reply.text));
  return choice.success ? choice.data.route : "notes";
}

// The SDK's choice: the options become an enum under the SDK's own key, "result".
async function sdkChoice(question: string) {
  const { output } = await generateText({
    model,
    instructions: ROUTER_V2,
    prompt: question,
    output: Output.choice({ options: [...ROUTES] }),
    temperature: 0,
    maxOutputTokens: 20,
  });
  return output;
}

// The SDK with your schema: the same enum, under your key, "route".
async function sdkObject(question: string) {
  const { output } = await generateText({
    model,
    instructions: ROUTER_V2,
    prompt: question,
    output: Output.object({ schema: RouteChoice }),
    temperature: 0,
    maxOutputTokens: 20,
  });
  return output.route;
}

const ways = [
  { name: "yours", run: yours },
  { name: "sdk choice", run: sdkChoice },
  { name: "sdk object", run: sdkObject },
];

console.log(`\nid       should be   ${ways.map((way) => way.name.padEnd(19)).join("")}`);
const right = ways.map(() => 0);
for (const evalCase of cases) {
  const cells: string[] = [];
  for (const [i, way] of ways.entries()) {
    const r = await timed(() => way.run(evalCase.input));
    if (r.value === evalCase.route) right[i]++;
    cells.push(`${r.value === evalCase.route ? "✓" : "✗"} ${r.value.padEnd(6)} ${r.seconds.toFixed(1)} s`.padEnd(19));
  }
  console.log(`${evalCase.id.padEnd(8)} ${String(evalCase.route).padEnd(11)} ${cells.join("")}`);
}
console.log(`\n${ways.map((way, i) => `${way.name} ${right[i]}/${cases.length}`).join(" · ")}`);
console.log("Run with --profile or --model to try another model: the router's prompt and cases stay the same.");
