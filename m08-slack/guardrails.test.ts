// Checks for the guardrails.  Run:  npx tsx --test m08-slack/guardrails.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkQuestion, cleanAnswer, MAX_QUESTION, questionFrom } from "./guardrails";

test("the question is the mention's text, without the mention and Slack's escaping", () => {
  assert.equal(questionFrom("<@U07ABC123> is 3 &lt; 5 &amp; true?"), "is 3 < 5 & true?");
  assert.equal(questionFrom("hey <@U07ABC123|study-buddy>, what is BM25?"), "hey , what is BM25?");
});

test("an empty or a too-long question is refused, with a reason", () => {
  assert.match(checkQuestion("") ?? "", /Ask me something/);
  assert.match(checkQuestion("x".repeat(MAX_QUESTION + 1)) ?? "", /shorten/);
  assert.equal(checkQuestion("What is BM25?"), null);
});

test("the model can't notify a whole channel", () => {
  assert.equal(cleanAnswer("Done! <!channel> look at this"), "Done! &lt;!channel&gt; look at this");
  assert.equal(cleanAnswer("<!here|here>"), "&lt;!here|here&gt;");
});

test("the model can't mention people or disguise a link", () => {
  assert.equal(cleanAnswer("Ask <@U0BOSS>"), "Ask &lt;@U0BOSS&gt;");
  assert.equal(cleanAnswer("<https://evil.example|your notes>"), "&lt;https://evil.example|your notes&gt;");
});

test("anything that looks like a token is removed", () => {
  assert.equal(cleanAnswer("The token is xoxb-1234-5678-abcdefgh"), "The token is [secret removed]");
  assert.equal(cleanAnswer("key: sk-abcdefghijklmnopqrstuvwxyz"), "key: [secret removed]");
});

test("Markdown becomes Slack's formatting", () => {
  assert.equal(cleanAnswer("It uses **BM25**."), "It uses *BM25*.");
  assert.equal(cleanAnswer("## Answer\nYes"), "*Answer*\nYes");
  assert.equal(cleanAnswer("See [the docs](https://example.com)."), "See the docs (https://example.com).");
});

test("ordinary text is unchanged, and & is still shown as &", () => {
  assert.equal(cleanAnswer("R&D, in 3 sentences."), "R&amp;D, in 3 sentences.");
});
