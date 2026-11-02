// The bot's eval cases. They start with questions from earlier modules, and grow from the
// answers people marked 👎 (report.ts --export). Two checks, one per component:
//   - "route": the route the router should pick. Cheap to check: one short model call.
//   - "expected": scored like Module 6's tasks, correct if the answer contains every string.
//     A case whose expected is still null waits for you to write it.

import { readFileSync, writeFileSync } from "node:fs";
import type { Context, Route } from "./assistant";

export type Case = { id: string; input: string; route?: Route; context?: Context; expected: string[] | null; note: string };

const FILE = new URL("./cases.json", import.meta.url);

export const loadCases = (): Case[] => JSON.parse(readFileSync(FILE, "utf8"));
export const saveCases = (cases: Case[]) => writeFileSync(FILE, `${JSON.stringify(cases, null, 2)}\n`);
