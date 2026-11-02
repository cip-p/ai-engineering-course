// The RAG eval questions. Each has a reference answer (null when the notes can't answer
// it, so the right response is "I don't know") and the section(s) where the answer is.

import { readFileSync } from "node:fs";

export type RagQuestion = {
  id: string;
  input: string;
  expected: { answer: string | null; sections: string[] };
};

export const loadQuestions = (): RagQuestion[] => JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf8"));
