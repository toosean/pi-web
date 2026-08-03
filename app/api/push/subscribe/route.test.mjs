import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("push subscribe route exposes the VAPID public key and registration state via GET", () => {
  assert.match(source, /export async function GET/);
  assert.match(source, /vapidPublicKey/);
  assert.match(source, /registered/);
  assert.match(source, /force-dynamic/);
});

test("push subscribe route validates subscription payloads on POST", () => {
  assert.match(source, /export async function POST/);
  assert.match(source, /Invalid push subscription/);
  assert.match(source, /subscription\.keys\?\.p256dh/);
  assert.match(source, /subscription\.keys\?\.auth/);
  assert.match(source, /addPushSubscription/);
});

test("push subscribe route removes a subscription by endpoint on DELETE", () => {
  assert.match(source, /export async function DELETE/);
  assert.match(source, /removePushSubscription/);
  assert.match(source, /Missing endpoint/);
});
