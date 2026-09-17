import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  generateSuggestedReplies,
  MAX_SUGGESTED_REPLIES,
  parseSuggestedReplies,
  SUGGESTED_REPLIES_PROMPT,
} = await jiti.import("./suggested-replies.ts");

function assistantMessage(text, usage) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("accepts between one and four useful replies without padding", () => {
  assert.deepEqual(
    parseSuggestedReplies('{"suggestions":["可以，直接发布到 PM2。"]}'),
    ["可以，直接发布到 PM2。"],
  );
  assert.equal(MAX_SUGGESTED_REPLIES, 4);
  assert.match(SUGGESTED_REPLIES_PROMPT, /between 1 and 4/i);
  assert.match(SUGGESTED_REPLIES_PROMPT, /Do not add weak or repetitive suggestions just to reach four/i);
});

test("strips JSON fences, removes duplicates, and caps replies at four", () => {
  const suggestions = parseSuggestedReplies(`\`\`\`json
{"suggestions":["First reply.","First reply.","Second reply.","Third reply.","Fourth reply.","Fifth reply."]}
\`\`\``);

  assert.deepEqual(suggestions, ["First reply.", "Second reply.", "Third reply.", "Fourth reply."]);
});

test("accepts a JSON payload wrapped in model commentary or returned as a bare array", () => {
  assert.deepEqual(
    parseSuggestedReplies('Here are the options:\n{"suggestions":["第一条。","第二条。"]}\nChoose one.'),
    ["第一条。", "第二条。"],
  );
  assert.deepEqual(parseSuggestedReplies('["Proceed with deployment."]'), ["Proceed with deployment."]);
});

test("rejects malformed or empty suggested reply payloads", () => {
  assert.throws(() => parseSuggestedReplies("not json"), /valid suggested replies JSON/);
  assert.throws(() => parseSuggestedReplies('{"suggestions":[]}'), /any usable suggested replies/);
  assert.throws(() => parseSuggestedReplies('{"suggestions":["---",null]}'), /any usable suggested replies/);
});

test("generates replies from the supplied completed-message context and returns usage", async () => {
  let providerMessages;
  const usage = {
    input: 12,
    output: 8,
    cacheRead: 3,
    cacheWrite: 2,
    totalTokens: 25,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const contextMessages = [
    { role: "user", content: "请把功能发布到 PM2。", timestamp: 1 },
    assistantMessage("需要等待当前运行任务结束。"),
  ];
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: contextMessages,
    },
    convertToLlm: (messages) => messages,
    streamFunction: (_model, context) => {
      providerMessages = context.messages.map((message) => ({ ...message }));
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: assistantMessage('{"suggestions":["好的，等任务结束后再发布。","先不要发布。"]}', usage),
        });
      });
      return stream;
    },
    sessionId: "source-session-id",
  };

  const result = await generateSuggestedReplies({ agent: sourceAgent }, contextMessages);

  assert.equal(result.suggestions.length, 2);
  assert.equal(result.suggestions[0], "好的，等任务结束后再发布。");
  assert.equal(result.suggestions[1], "先不要发布。");
  assert.deepEqual(result.usage, { input: 12, output: 8, cacheRead: 3, cacheWrite: 2, total: 25 });
  assert.deepEqual(providerMessages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.match(providerMessages.at(-1).content[0].text, /between 1 and 4/i);
});

test("requires the selected context to end in a completed assistant message", async () => {
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: [],
    },
  };

  await assert.rejects(
    generateSuggestedReplies({ agent: sourceAgent }, [{ role: "user", content: "Continue", timestamp: 1 }]),
    /completed assistant message/,
  );
});
