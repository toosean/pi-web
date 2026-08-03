import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { recordAndCheckSuppress, wasRecentlyNotified } = await jiti.import("./push-notifier.ts");
const source = await readFile(new URL("./push-notifier.ts", import.meta.url), "utf8");

test("push-notifier dedups identical notifications per session", () => {
  const sessionId = `test-dedup-${Date.now()}`;
  assert.equal(recordAndCheckSuppress(sessionId, "completed"), false);
  assert.equal(recordAndCheckSuppress(sessionId, "completed"), true);
  // A different kind for the same session is not suppressed.
  assert.equal(recordAndCheckSuppress(sessionId, "waiting"), false);
});

test("wasRecentlyNotified honors an explicit window", async () => {
  const sessionId = `test-window-${Date.now()}`;
  recordAndCheckSuppress(sessionId, "completed");
  assert.equal(wasRecentlyNotified(sessionId, "completed", 1_000), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(wasRecentlyNotified(sessionId, "completed", 1), false);
});

test("push-notifier persists VAPID keys and subscriptions under the pi-web data dir", () => {
  assert.match(source, /vapid\.json/);
  assert.match(source, /push-subscriptions\.json/);
  assert.match(source, /writePrivateFileAtomicSync/);
  assert.match(source, /PI_WEB_VAPID_PUBLIC_KEY/);
  assert.match(source, /generateVAPIDKeys/);
});

test("push-notifier drops stale endpoints (404/410) after sending", () => {
  assert.match(source, /404 \|\| code === 410/);
  assert.match(source, /staleEndpoints/);
  assert.match(source, /webpush\.sendNotification/);
  assert.match(source, /TTL: 60 \* 60/);
});

test("push-notifier localizes copy by subscription locale", () => {
  assert.match(source, /pickLocale/);
  assert.match(source, /COPY\[kind\]\[pickLocale\(locale\)\]/);
  assert.match(source, /"zh-CN"/);
  assert.match(source, /"zh-TW"/);
});
