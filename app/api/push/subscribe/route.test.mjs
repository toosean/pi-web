import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("push subscribe route exposes the VAPID public key via GET", () => {
  assert.match(source, /export async function GET/);
  assert.match(source, /getVapidPublicKey/);
  assert.match(source, /force-dynamic/);
});

test("push subscribe route validates subscription payloads on POST", () => {
  assert.match(source, /export async function POST/);
  assert.match(source, /Invalid push subscription/);
  assert.match(source, /keys\.p256dh/);
  assert.match(source, /keys\.auth/);
  assert.match(source, /addSubscription/);
});

test("push subscribe route removes a subscription by endpoint on DELETE", () => {
  assert.match(source, /export async function DELETE/);
  assert.match(source, /removeSubscription/);
  assert.match(source, /Missing endpoint/);
});
