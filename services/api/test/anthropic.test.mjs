/**
 * The Anthropic client on a clan's own key, over a scripted fetch: the
 * request's shape (the key in its header, one forced tool), the answer
 * read from the tool call, refusals kept in Anthropic's own words, and a
 * trace entry that carries time and tokens, never the key or the words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTHROPIC_VERSION, createAnthropicClient } from "../src/anthropic.mjs";
import { current, summarize, withTrace } from "../src/trace.mjs";

const KEY = `sk-ant-api03-${"k".repeat(40)}`;
const TOOL = {
  name: "write_pitch",
  description: "d",
  input_schema: { type: "object" },
};
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("anthropic: a message is one forced tool call on the clan's key, timed without the key or the words", async () => {
  const seen = [];
  const client = createAnthropicClient({
    url: "https://anthropic.test",
    fetch: async (url, init) => {
      seen.push({ url, init });
      return reply(200, {
        model: "claude-sonnet-5",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 120 },
        content: [
          { type: "text", text: "Here it is." },
          { type: "tool_use", name: "write_pitch", input: { tagline: "Hi" } },
        ],
      });
    },
  });
  const summary = await withTrace({ http: "POST /x" }, async () => {
    const r = await client.write(KEY, {
      model: "claude-sonnet-5",
      system: "SYSTEM WORDS",
      prompt: "PROMPT WORDS",
      tool: TOOL,
      max_tokens: 1200,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.input, { tagline: "Hi" });
    assert.equal(r.usage.output_tokens, 120);
    return summarize(current(), 200);
  });
  const { url, init } = seen[0];
  assert.equal(url, "https://anthropic.test/v1/messages");
  assert.equal(init.headers["x-api-key"], KEY);
  assert.equal(init.headers["anthropic-version"], ANTHROPIC_VERSION);
  const body = JSON.parse(init.body);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "write_pitch" });
  assert.equal(body.messages[0].content, "PROMPT WORDS");
  assert.equal(summary.model_calls, 1);
  assert.equal(summary.model[0].output_tokens, 120);
  const line = JSON.stringify(summary);
  for (const secret of [KEY, "PROMPT WORDS", "SYSTEM WORDS", "Hi"])
    assert.ok(!line.includes(secret), secret);
});

test("anthropic: the model list checks a key; refusals and silence are named, never with the key", async () => {
  let answer = reply(200, {
    data: [
      { type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
    ],
  });
  const client = createAnthropicClient({
    url: "https://anthropic.test",
    fetch: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  assert.deepEqual((await client.models(KEY)).models, [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  ]);
  answer = reply(401, {
    type: "error",
    error: { type: "authentication_error", message: "invalid x-api-key" },
  });
  const refused = await client.models(KEY);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 401);
  assert.equal(refused.code, "authentication_error");
  answer = Object.assign(new Error("slow"), { name: "TimeoutError" });
  assert.equal((await client.models(KEY)).code, "timeout");
  answer = reply(200, { stop_reason: "max_tokens", content: [] });
  const empty = await client.write(KEY, {
    model: "m",
    system: "s",
    prompt: "p",
    tool: TOOL,
    max_tokens: 10,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "no_answer");
});
