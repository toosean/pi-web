import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_SESSION_PAYLOAD_ENTRIES,
  SESSION_PAYLOAD_MAX_AGE_MS,
  invalidateSessionPayloadCache,
  readSessionPayloadCache,
  sessionPayloadCacheSize,
  writeSessionPayloadCache,
} = await jiti.import("./session-payload-cache.ts");

const identity = (filePath, overrides = {}) => ({
  filePath,
  mtimeMs: 1000,
  size: 2048,
  ctimeMs: 500,
  ...overrides,
});

test("serves a cached payload while the file identity is unchanged", () => {
  invalidateSessionPayloadCache();
  const file = "/sessions/a.jsonl";
  writeSessionPayloadCache(identity(file), "50|t|t|t", { messages: [1, 2] }, 10_000);

  assert.deepEqual(readSessionPayloadCache(identity(file), "50|t|t|t", 10_001), { messages: [1, 2] });
  invalidateSessionPayloadCache();
});

test("a growing file, a rewrite, or a rename invalidates the entry", () => {
  invalidateSessionPayloadCache();
  const file = "/sessions/b.jsonl";
  writeSessionPayloadCache(identity(file), "p", { v: 1 }, 10_000);

  // Append: size changes.
  assert.equal(readSessionPayloadCache(identity(file, { size: 4096 }), "p", 10_001), null);
  assert.equal(sessionPayloadCacheSize(), 0, "a mismatched entry must be dropped, not kept");

  writeSessionPayloadCache(identity(file), "p", { v: 2 }, 10_000);
  // Rewrite with the same size: mtime (and ctime) change.
  assert.equal(readSessionPayloadCache(identity(file, { mtimeMs: 2000, ctimeMs: 900 }), "p", 10_001), null);

  writeSessionPayloadCache(identity(file), "p", { v: 3 }, 10_000);
  assert.equal(readSessionPayloadCache(identity("/sessions/renamed.jsonl"), "p", 10_001), null);
  invalidateSessionPayloadCache();
});

test("different request parameters never share an entry", () => {
  invalidateSessionPayloadCache();
  const file = "/sessions/c.jsonl";
  writeSessionPayloadCache(identity(file), "50|t|t|t", { tail: 50 }, 10_000);

  assert.deepEqual(readSessionPayloadCache(identity(file), "50|t|t|t", 10_000), { tail: 50 });
  assert.equal(readSessionPayloadCache(identity(file), "200|t|t|t", 10_000), null);
  assert.equal(readSessionPayloadCache(identity(file), "50|f|t|t", 10_000), null);
  invalidateSessionPayloadCache();
});

test("entries expire even when the file did not change", () => {
  invalidateSessionPayloadCache();
  const file = "/sessions/d.jsonl";
  writeSessionPayloadCache(identity(file), "p", { v: 1 }, 10_000);

  assert.notEqual(readSessionPayloadCache(identity(file), "p", 10_000 + SESSION_PAYLOAD_MAX_AGE_MS - 1), null);
  writeSessionPayloadCache(identity(file), "p", { v: 1 }, 10_000);
  assert.equal(readSessionPayloadCache(identity(file), "p", 10_000 + SESSION_PAYLOAD_MAX_AGE_MS + 1), null);
  invalidateSessionPayloadCache();
});

test("keeps the cache bounded and drops the least recently read entry", () => {
  invalidateSessionPayloadCache();
  const files = Array.from({ length: MAX_SESSION_PAYLOAD_ENTRIES + 4 }, (_, i) => `/sessions/e${i}.jsonl`);
  for (const [index, file] of files.entries()) {
    writeSessionPayloadCache(identity(file), "p", { index }, 20_000);
  }
  assert.equal(sessionPayloadCacheSize(), MAX_SESSION_PAYLOAD_ENTRIES);
  assert.equal(readSessionPayloadCache(identity(files[0]), "p", 20_000), null, "oldest dropped");
  assert.deepEqual(readSessionPayloadCache(identity(files[files.length - 1]), "p", 20_000), {
    index: files.length - 1,
  });
  invalidateSessionPayloadCache();
});

test("invalidateSessionPayloadCache targets one file or everything", () => {
  invalidateSessionPayloadCache();
  writeSessionPayloadCache(identity("/sessions/f1.jsonl"), "p", { v: 1 }, 0);
  writeSessionPayloadCache(identity("/sessions/f2.jsonl"), "p", { v: 2 }, 0);

  invalidateSessionPayloadCache("/sessions/f1.jsonl");
  assert.equal(readSessionPayloadCache(identity("/sessions/f1.jsonl"), "p", 0), null);
  assert.deepEqual(readSessionPayloadCache(identity("/sessions/f2.jsonl"), "p", 0), { v: 2 });

  invalidateSessionPayloadCache();
  assert.equal(sessionPayloadCacheSize(), 0);
});
