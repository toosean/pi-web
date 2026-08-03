import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PwaBadge.tsx", import.meta.url), "utf8");

test("PwaBadge mirrors the running-session count onto the app badge", () => {
  assert.match(source, /setAppBadge/);
  assert.match(source, /clearAppBadge/);
  assert.match(source, /runningSessionIds\.length/);
});

test("PwaBadge subscribes to the running-session SSE stream and probes on mount", () => {
  assert.match(source, /\/api\/agent\/running\/events/);
  assert.match(source, /\/api\/agent\/running/);
  assert.match(source, /new EventSource/);
});

test("PwaBadge bails out when the Badging API or service workers are unavailable", () => {
  assert.match(source, /"setAppBadge" in navigator/);
  assert.match(source, /"clearAppBadge" in navigator/);
  assert.match(source, /"serviceWorker" in navigator/);
});
