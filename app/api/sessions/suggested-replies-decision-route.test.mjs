import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./[id]/entries/[entryId]/suggested-replies/decision/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");
const entries = [
  { type: "message", id: "user", parentId: null, message: { role: "user", content: "User context must not be sent" } },
  { type: "message", id: "answer", parentId: "user", message: {
    role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "Hidden reasoning" }, { type: "text", text: "Choose A or B?" }],
  } },
];

function setup(t) {
  const originalFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  const oldSessions = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  process.env.PI_WEB_AUTO_REPLY_IDEAS_ENABLED = "1";
  process.env.TYPESAFE_API_KEY = "route-test-key";
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).state, { assistant_message: "Choose A or B?" });
    return Response.json({ answers: { should_offer_reply_ideas: { type: "noul", noul: 0.95 } } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__piSessions = oldSessions;
    for (const key of ["PI_WEB_AUTO_REPLY_IDEAS_ENABLED", "TYPESAFE_API_KEY"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  });
  return () => calls;
}

const request = (id, entryId = "answer") => POST(new Request("http://localhost/decision", { method: "POST" }), { params: Promise.resolve({ id, entryId }) });

test("reads exact live entry without prompting or changing session state", async t => {
  const calls = setup(t);
  globalThis.__piSessions.set("live", { isAlive: () => true, isRunning: () => false, inner: { sessionManager: { getEntries: () => entries } } });
  const before = JSON.stringify(entries);
  const response = await request("live");
  assert.equal((await response.json()).shouldOpen, true);
  assert.equal(JSON.stringify(entries), before);
  assert.equal(calls(), 1);
  assert.equal((await request("live", "missing")).status, 404);
  assert.equal((await request("live", "user")).status, 404);
});

test("dormant sessions are read without creating a wrapper or modifying the file", async t => {
  setup(t);
  const dir = await mkdtemp(join(tmpdir(), "reply-ideas-route-"));
  const path = join(dir, "session.jsonl");
  const content = [
    { type: "session", version: 3, id: "dormant", timestamp: new Date().toISOString(), cwd: dir },
    ...entries,
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n";
  await writeFile(path, content);
  cacheSessionPath("dormant", path);
  t.after(async () => { invalidateSessionPathCache("dormant"); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await (await request("dormant")).json()).shouldOpen, true);
  assert.equal(globalThis.__piSessions.size, 0);
  assert.equal(await readFile(path, "utf8"), content);
});

test("running, subagent, aborted and image-only entries are skipped without Jev", async t => {
  const calls = setup(t);
  for (const [id, running, data] of [
    ["running", true, entries],
    ["subagent", false, [{ type: "custom", customType: "pi-web:subagent" }, ...entries]],
    ["aborted", false, [{ ...entries[1], message: { ...entries[1].message, stopReason: "aborted" } }]],
    ["image", false, [{ ...entries[1], message: { ...entries[1].message, content: [{ type: "image", source: {} }] } }]],
  ]) {
    globalThis.__piSessions.set(id, { isAlive: () => true, isRunning: () => running, inner: { sessionManager: { getEntries: () => data } } });
    assert.equal((await (await request(id)).json()).shouldOpen, false);
  }
  assert.equal(calls(), 0);
});
