import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { replyIdeasText, latestReplyIdeasEntry, ReplyIdeasTurnTracker } = await jiti.import("./reply-ideas-target.ts");
const user = { role: "user", content: "Help" };
const assistant = { role: "assistant", content: [{ type: "text", text: "Which option?" }], stopReason: "stop" };

test("only the visible final answer is sent to Jev", () => {
  assert.equal(replyIdeasText({ ...assistant, content: [
    { type: "text", text: "process" }, { type: "toolCall", toolName: "bash" },
    { type: "thinking", thinking: "private" }, ...assistant.content, { type: "image", source: {} },
  ] }), "Which option?");
  for (const stopReason of ["error", "aborted", "length", "toolUse"]) assert.equal(replyIdeasText({ ...assistant, stopReason }), "");
  assert.equal(replyIdeasText({ ...assistant, content: [{ type: "image", source: {} }] }), "");
  assert.equal(replyIdeasText(user), "");
});

test("never falls back to a previous turn after a new user or failed assistant", () => {
  assert.equal(latestReplyIdeasEntry([user, assistant], ["u", "a"]), "a");
  assert.equal(latestReplyIdeasEntry([user, assistant, user], ["u", "a", "u2"]), null);
  assert.equal(latestReplyIdeasEntry([user, assistant, { ...assistant, stopReason: "error" }], ["u", "a", "error"]), null);
});

test("fresh sessions and recovered runs settle once; history and background do not", () => {
  const tracker = new ReplyIdeasTurnTracker();
  assert.equal(tracker.settle(true), null);
  tracker.start([]);
  const fresh = tracker.settle(true);
  assert.equal(fresh.accepts("first-answer"), true);
  assert.equal(tracker.settle(true), null);
  tracker.start(["first-answer"]);
  assert.equal(fresh.isCurrent(), false);
  // Reconnect / retry within this run keeps the original baseline.
  tracker.start(["first-answer", "intermediate"]);
  const recovered = tracker.settle(true);
  assert.equal(recovered.accepts("first-answer"), false);
  assert.equal(recovered.accepts("new-answer"), true);
  tracker.start(["new-answer"]);
  assert.equal(tracker.settle(false), null);
  assert.equal(tracker.settle(true), null);
});

test("abort, navigation and a new run invalidate late completion snapshots", () => {
  const tracker = new ReplyIdeasTurnTracker();
  tracker.start([]);
  const first = tracker.settle(true);
  tracker.invalidate();
  assert.equal(first.accepts("answer"), false);
  assert.equal(tracker.settle(true), null);
  tracker.start([]);
  const second = tracker.settle(true);
  tracker.start(["answer"]);
  assert.equal(second.isCurrent(), false);
});
