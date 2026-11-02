// The tasks for this module's lessons and eval. agent-eval.ts scores the ones with an
// "expected" list: the answer must contain every string in it. The others are for the
// lessons only, because their answers can't be checked by a string match.

import { readFileSync } from "node:fs";

export type Task = { id: string; input: string; expected: string[] | null; note: string };

export const loadTasks = (): Task[] => JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url), "utf8"));
