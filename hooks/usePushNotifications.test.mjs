import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./usePushNotifications.ts", import.meta.url), "utf8");

test("usePushNotifications checks browser support before doing anything", () => {
  assert.match(source, /"serviceWorker" in navigator/);
  assert.match(source, /"PushManager" in window/);
  assert.match(source, /"Notification" in window/);
});

test("usePushNotifications subscribes with the server VAPID key and userVisibleOnly", () => {
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /applicationServerKey/);
  assert.match(source, /userVisibleOnly/);
  assert.match(source, /urlBase64ToUint8Array/);
});

test("usePushNotifications registers and unregisters the server-side subscription", () => {
  assert.match(source, /\/api\/push\/subscribe/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /sub\.unsubscribe\(\)/);
});

test("usePushNotifications re-syncs subscription state on visibility change", () => {
  assert.match(source, /visibilitychange/);
  assert.match(source, /getSubscription\(\)/);
});
