import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSessionContext } from "@earendil-works/pi-coding-agent";

const routeSource = readFileSync(
  new URL("./[id]/entries/[entryId]/suggested-replies/route.ts", import.meta.url),
  "utf8",
);

test("suggested replies route validates an assistant entry and builds its exact branch context", () => {
  assert.match(routeSource, /entry\.type !== "message" \|\| entry\.message\.role !== "assistant"/);
  assert.match(routeSource, /buildSessionContext\(manager\.getEntries\(\), entryId\)/);
  assert.match(routeSource, /generateSuggestedReplies\([\s\S]*?context\.messages/);
});

test("SDK context selection excludes messages from sibling branches", () => {
  const user = (id, parentId, content) => ({
    id,
    parentId,
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role: "user", content, timestamp: Date.now() },
  });
  const assistant = (id, parentId, content) => ({
    id,
    parentId,
    type: "message",
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: content }],
      api: "test",
      provider: "test",
      model: "test-model",
      stopReason: "stop",
      timestamp: Date.now(),
    },
  });
  const entries = [
    user("u0", null, "Root question"),
    assistant("a0", "u0", "Root answer"),
    user("u-left", "a0", "Left question"),
    assistant("a-left", "u-left", "Left answer"),
    user("u-right", "a0", "Right question"),
    assistant("a-right", "u-right", "Right answer"),
  ];

  const context = buildSessionContext(entries, "a-left");
  const serialized = JSON.stringify(context.messages);
  assert.match(serialized, /Left answer/);
  assert.doesNotMatch(serialized, /Right question|Right answer/);
});

test("suggested replies route exposes stable status codes", () => {
  assert.match(routeSource, /Session not found" \}, \{ status: 404 \}/);
  assert.match(routeSource, /Assistant message not found" \}, \{ status: 404 \}/);
  assert.match(routeSource, /status: 409/);
  assert.match(routeSource, /status: 500/);
});
