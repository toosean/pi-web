import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  generateSuggestedReplies,
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

test("generates short phrases without imposing a fixed count", () => {
  assert.deepEqual(
    parseSuggestedReplies('{"suggestions":["直接发布到 PM2。"]}'),
    ["直接发布到 PM2"],
  );
  assert.match(SUGGESTED_REPLIES_PROMPT, /short phrase/i);
  assert.match(SUGGESTED_REPLIES_PROMPT, /rewrite questions as intent phrases/i);
  assert.match(SUGGESTED_REPLIES_PROMPT, /as many genuinely useful/i);
  assert.match(SUGGESTED_REPLIES_PROMPT, /do not target, pad, or cap/i);
  assert.doesNotMatch(SUGGESTED_REPLIES_PROMPT, /between 1 and 4|at most 4|maximum of 4/i);
});

test("strips JSON fences, removes duplicates, and preserves more than four phrases", () => {
  const suggestions = parseSuggestedReplies(`\`\`\`json
{"suggestions":["Run tests.","Run tests","Review changes!","Commit code;","Build release：","Deploy to PM2。","Verify health?"]}
\`\`\``);

  assert.deepEqual(suggestions, ["Run tests", "Review changes", "Commit code", "Build release", "Deploy to PM2", "Verify health"]);
});

test("accepts a JSON payload wrapped in model commentary or returned as a bare array", () => {
  assert.deepEqual(
    parseSuggestedReplies('Here are the options:\n{"suggestions":["查看实现。","运行测试！"]}\nChoose one.'),
    ["查看实现", "运行测试"],
  );
  assert.deepEqual(parseSuggestedReplies('["Proceed with deployment."]'), ["Proceed with deployment"]);
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
          message: assistantMessage('{"suggestions":["等待任务结束","暂不发布"]}', usage),
        });
      });
      return stream;
    },
    sessionId: "source-session-id",
  };

  const result = await generateSuggestedReplies({ agent: sourceAgent }, contextMessages);

  assert.equal(result.suggestions.length, 2);
  assert.equal(result.suggestions[0], "等待任务结束");
  assert.equal(result.suggestions[1], "暂不发布");
  assert.deepEqual(result.usage, { input: 12, output: 8, cacheRead: 3, cacheWrite: 2, total: 25 });
  assert.deepEqual(providerMessages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.match(providerMessages.at(-1).content[0].text, /as many genuinely useful/i);
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
