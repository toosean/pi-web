import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mergeRevalidatedSessionData } = await jiti.import("./session-cache.ts");

const sessionData = (entryIds, overrides = {}) => ({
  sessionId: "session",
  filePath: "/tmp/session.jsonl",
  totalActiveMs: 0,
  tree: [],
  leafId: entryIds.at(-1) ?? null,
  context: {
    entryIds,
    messages: entryIds.map((id) => ({ role: "user", content: id })),
    oldestEntryId: entryIds[0] ?? null,
    hasMore: entryIds[0] !== "root",
    thinkingLevel: "off",
    model: null,
  },
  ...overrides,
});

test("revalidation preserves paged ancestors and replaces the overlapping tail", () => {
  const current = sessionData(["older-1", "older-2", "tail-1", "tail-2"]);
  const fresh = sessionData(["tail-1", "tail-2", "new-tail"]);

  const merged = mergeRevalidatedSessionData(current, fresh);

  assert.deepEqual(merged.context.entryIds, ["older-1", "older-2", "tail-1", "tail-2", "new-tail"]);
  assert.deepEqual(merged.context.messages.map((message) => message.content), merged.context.entryIds);
  assert.equal(merged.context.oldestEntryId, "older-1");
  assert.equal(merged.context.hasMore, true);
  assert.equal(merged.leafId, "new-tail");
});

test("revalidation replaces unrelated branches instead of splicing their history", () => {
  const current = sessionData(["root", "old-branch"]);
  const fresh = sessionData(["new-root", "new-branch"]);

  assert.equal(mergeRevalidatedSessionData(current, fresh), fresh);
});
