import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");

test("running events immediately emits an SSE snapshot and supports cancellation", async () => {
  const response = await GET(new Request("http://localhost/api/agent/running/events"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  const frame = new TextDecoder().decode(first.value);
  assert.match(frame, /^data: /);
  const payload = JSON.parse(frame.slice(6));
  assert.equal(payload.type, "running");
  assert.ok(Array.isArray(payload.runningSessionIds));
  assert.ok(Array.isArray(payload.completionNotificationSuppressedSessionIds));
  await reader.cancel();
});
