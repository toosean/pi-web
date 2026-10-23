import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useSessionUiState } = await jiti.import("./useSessionUiState.ts");
const { useUnreadSessions } = await jiti.import("./useUnreadSessions.ts");
const { applySessionUiStateRequest } = await jiti.import("../lib/session-ui-state-shared.ts");
const legacyKey = "pi-web:unread-session-ids";
const mounted = [];
const previousFetch = globalThis.fetch;
const previousWindow = globalThis.window;
let server;
let writes;
let storage;
let refuseWrite;
let refuseFlag;
let refuseRead;

test.beforeEach(() => {
  server = { version: 1, revision: 0, sessions: {}, projects: {} };
  writes = [];
  storage = new Map();
  refuseWrite = false;
  refuseFlag = null;
  refuseRead = false;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "POST") {
      const request = JSON.parse(init.body);
      writes.push(request);
      if (refuseWrite || (refuseFlag && request[refuseFlag])) {
        refuseWrite = false; refuseFlag = null;
        return Response.json({ error: "busy" }, { status: 503 });
      }
      const result = applySessionUiStateRequest(server, request, Date.now());
      server = { ...result.state, revision: server.revision + (result.changed ? 1 : 0) };
    } else if (refuseRead) {
      refuseRead = false;
      return Response.json({ error: "offline" }, { status: 503 });
    }
    return Response.json({ state: server });
  };
});
test.afterEach(() => {
  for (const hook of mounted.splice(0)) hook.unmount();
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
function render() {
  const hook = renderHook(() => {
    const ui = useSessionUiState();
    return { ...ui, ...useUnreadSessions(ui) };
  });
  mounted.push(hook);
  return hook;
}
async function settle(hook) {
  for (let round = 0; round < 4; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    hook.flush();
  }
}

test("no-op unread updates complete without recursion or requests", async () => {
  const hook = render();
  await settle(hook);
  let calls = 0;
  hook.result.updateUnread((previous) => { calls++; return previous; });
  await settle(hook);
  assert.equal(calls, 1);
  assert.deepEqual(writes, []);
});

test("later server revisions add and clear unread markers without echo writes", async () => {
  server.unreadIds = ["old"];
  const hook = render();
  await settle(hook);
  assert.deepEqual([...hook.result.unreadSessionIds], ["old"]);
  server = { ...server, revision: 1, unreadIds: ["remote"] };
  hook.result.noteRevision(1);
  await settle(hook);
  assert.deepEqual([...hook.result.unreadSessionIds], ["remote"]);
  server = { ...server, revision: 2, unreadIds: [] };
  hook.result.noteRevision(2);
  await settle(hook);
  assert.deepEqual([...hook.result.unreadSessionIds], []);
  assert.deepEqual(writes, []);
});

test("legacy unread imports once; reloading cannot resurrect a remotely cleared marker", async () => {
  storage.set(legacyKey, JSON.stringify(["legacy"]));
  const hook = render();
  await settle(hook);
  assert.deepEqual(server.unreadIds, ["legacy"]);
  assert.equal(storage.has(legacyKey), false);
  assert.equal(storage.get(`${legacyKey}:imported`), "true");
  hook.unmount(); mounted.pop();
  server = { ...server, revision: 2, unreadIds: [] };
  // Even an old browser backup must not re-import after successful migration.
  storage.set(legacyKey, JSON.stringify(["legacy"]));
  const reloaded = render();
  await settle(reloaded);
  assert.deepEqual([...reloaded.result.unreadSessionIds], []);
  assert.equal(writes.length, 1);
});

test("failed writes roll back and subsequent actions can retry the same marker", async () => {
  const hook = render();
  await settle(hook);
  refuseWrite = true;
  hook.result.updateUnread((previous) => new Set(previous).add("retry"));
  hook.flush();
  assert.equal(hook.result.unreadSessionIds.has("retry"), true);
  await settle(hook);
  assert.equal(hook.result.unreadSessionIds.has("retry"), false);
  hook.result.updateUnread((previous) => new Set(previous).add("retry"));
  await settle(hook);
  assert.deepEqual(server.unreadIds, ["retry"]);
  assert.equal(writes.length, 2);
});

test("multiple actions before rendering compose, and large sets use bounded requests", async () => {
  const hook = render();
  await settle(hook);
  hook.result.updateUnread((previous) => new Set(previous).add("first"));
  hook.result.updateUnread((previous) => new Set(previous).add("second"));
  await settle(hook);
  assert.deepEqual(server.unreadIds, ["first", "second"]);
  writes.length = 0;
  hook.result.updateUnread((previous) => new Set([...previous, ...Array.from({ length: 1200 }, (_, i) => `s${i}`)]));
  await settle(hook);
  assert.deepEqual(writes.map((request) => request.ids.length), [500, 500, 200]);
  assert.equal(hook.result.unreadSessionIds.size, 1202);
});

test("legacy migration waits for a successful read and retries failed imports after reload", async () => {
  storage.set(legacyKey, JSON.stringify(["legacy"]));
  refuseRead = true;
  const hook = render();
  await settle(hook);
  assert.equal(writes.length, 0);
  refuseWrite = true;
  hook.result.noteRevision(1);
  await settle(hook);
  assert.equal(storage.has(legacyKey), true);
  assert.equal(storage.has(`${legacyKey}:imported`), false);
  hook.unmount(); mounted.pop();
  const retry = render();
  await settle(retry);
  assert.deepEqual([...retry.result.unreadSessionIds], ["legacy"]);
  assert.equal(storage.has(legacyKey), false);
});

test("imports legacy pins, hides and unread together and removes their keys only on success", async () => {
  storage.set("pi-web:pinned-session-ids", JSON.stringify(["pin", "pin", "", "../invalid", null]));
  storage.set("pi-web:hidden-session-ids", JSON.stringify(["hide"]));
  storage.set(legacyKey, JSON.stringify(["unread"]));
  const hook = render();
  await settle(hook);
  assert.ok(server.sessions.pin.pinnedAt >= 0);
  assert.ok(server.sessions.hide.archivedAt >= 0);
  assert.deepEqual(server.unreadIds, ["unread"]);
  assert.deepEqual(writes.map(({ ids }) => ids), [["pin"], ["hide"], ["unread"]]);
  for (const key of ["pi-web:pinned-session-ids", "pi-web:hidden-session-ids", legacyKey]) {
    assert.equal(storage.has(key), false);
    assert.equal(storage.get(`${key}:imported`), "true");
  }
  assert.equal(storage.get("pi-web:session-flags-migrated"), "1");
});

test("a failed hide import retries without resurrecting pins cleared after their successful import", async () => {
  storage.set("pi-web:pinned-session-ids", JSON.stringify(["pin"]));
  storage.set("pi-web:hidden-session-ids", JSON.stringify(["hide"]));
  refuseFlag = "archived";
  const hook = render();
  await settle(hook);
  assert.ok(server.sessions.pin.pinnedAt >= 0);
  assert.equal(server.sessions.hide, undefined);
  assert.equal(storage.get("pi-web:pinned-session-ids:imported"), "true");
  assert.equal(storage.has("pi-web:hidden-session-ids"), true);
  assert.equal(storage.has("pi-web:session-flags-migrated"), false);
  hook.unmount(); mounted.pop();
  server = { ...server, revision: server.revision + 1, sessions: {} };
  storage.set("pi-web:pinned-session-ids", JSON.stringify(["pin"]));
  const retry = render();
  await settle(retry);
  assert.equal(server.sessions.pin, undefined);
  assert.ok(server.sessions.hide.archivedAt >= 0);
  assert.equal(storage.has("pi-web:hidden-session-ids"), false);
});

test("honors the original migration receipt and keeps current server flags over stale browser backups", async () => {
  storage.set("pi-web:pinned-session-ids", JSON.stringify(["archived"]));
  storage.set("pi-web:hidden-session-ids", JSON.stringify(["pinned"]));
  server.sessions = { archived: { archivedAt: 1 }, pinned: { pinnedAt: 2 } };
  const hook = render();
  await settle(hook);
  assert.deepEqual(server.sessions, { archived: { archivedAt: 1 }, pinned: { pinnedAt: 2 } });
  assert.deepEqual(writes, []);
  hook.unmount(); mounted.pop();
  storage.set("pi-web:pinned-session-ids", JSON.stringify(["old"]));
  storage.set(legacyKey, JSON.stringify(["old"]));
  const reloaded = render();
  await settle(reloaded);
  assert.equal(server.sessions.old, undefined);
  assert.equal(server.unreadIds, undefined);
  assert.deepEqual(writes, []);
});

test("legacy pin imports are chunked and a malformed flag does not block the others", async () => {
  storage.set("pi-web:pinned-session-ids", JSON.stringify(Array.from({ length: 1200 }, (_, i) => `pin${i}`)));
  storage.set("pi-web:hidden-session-ids", "{bad-json");
  storage.set(legacyKey, JSON.stringify(["unread"]));
  const hook = render();
  await settle(hook);
  assert.deepEqual(writes.map((request) => request.ids.length), [500, 500, 200, 1]);
  assert.equal(Object.keys(server.sessions).length, 1200);
  assert.deepEqual(server.unreadIds, ["unread"]);
  assert.equal(storage.has("pi-web:hidden-session-ids"), true);
  assert.equal(storage.has("pi-web:session-flags-migrated"), false);
});
