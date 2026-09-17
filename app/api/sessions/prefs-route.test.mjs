// Sidebar flags (pin / hide / unread) moved from browser `localStorage` to
// `~/.pi-web/session-preferences.json`. These tests exercise the real routes
// against a temp agent dir, so the write path, the session-id validation, the
// list decoration and the out-of-band prune are all covered without a browser.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const testRoot = mkdtempSync(join(tmpdir(), "pi-web-prefs-route-"));
const agentDir = join(testRoot, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const sessionId = "11111111-2222-3333-4444-555555555555";
const ghostId = "99999999-8888-7777-6666-555555555555";
const projectDir = join(agentDir, "sessions", "--tmp-proj--");
mkdirSync(projectDir, { recursive: true });
writeFileSync(
  join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`),
  [
    JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/proj",
    }),
    JSON.stringify({
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "hello" },
    }),
  ].join("\n") + "\n",
);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT } = await jiti.import("./[id]/prefs/route.ts");
const { POST } = await jiti.import("../session-preferences/migrate/route.ts");
const { GET: listSessions } = await jiti.import("./route.ts");

/** Fails with the route's own error body instead of an opaque `undefined`. */
async function listSessionsPayload() {
  const response = await listSessions(new Request("http://localhost/api/sessions"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body).slice(0, 600));
  return body;
}

const prefsPath = join(testRoot, "pi-web", "session-preferences.json");

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(testRoot, { recursive: true, force: true });
});

function putRequest(id, body) {
  return new Request(`http://localhost/api/sessions/${id}/prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

function params(id) {
  return { params: Promise.resolve({ id }) };
}

function storedPrefs() {
  return JSON.parse(readFileSync(prefsPath, "utf8"));
}

test("flag updates require a valid body and a known session", async () => {
  let response = await PUT(putRequest(sessionId, {}), params(sessionId));
  assert.equal(response.status, 400);

  response = await PUT(putRequest(sessionId, { pinned: "yes" }), params(sessionId));
  assert.equal(response.status, 400);

  response = await PUT(putRequest(ghostId, { pinned: true }), params(ghostId));
  assert.equal(response.status, 404);
});

test("the prefs route persists flags and the list route delivers them", async () => {
  let response = await PUT(putRequest(sessionId, { pinned: true }), params(sessionId));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: sessionId, flags: { pinned: true } });
  assert.deepEqual(storedPrefs(), { version: 1, sessions: { [sessionId]: { pinned: true } } });

  response = await PUT(putRequest(sessionId, { hidden: true, unread: true }), params(sessionId));
  assert.deepEqual(await response.json(), {
    ok: true,
    id: sessionId,
    flags: { pinned: true, hidden: true, unread: true },
  });

  const list = await listSessionsPayload();
  const decorated = list.sessions.find((session) => session.id === sessionId);
  assert.deepEqual(
    { pinned: decorated.pinned, hidden: decorated.hidden, unread: decorated.unread },
    { pinned: true, hidden: true, unread: true },
  );
  // Sessions without flags must not grow explicit `false` fields.
  const other = list.sessions.find((session) => session.id !== sessionId);
  if (other) assert.equal("pinned" in other, false);
});

test("clearing the last flag removes the session entry", async () => {
  for (const flag of ["pinned", "hidden", "unread"]) {
    const response = await PUT(putRequest(sessionId, { [flag]: false }), params(sessionId));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(storedPrefs(), { version: 1, sessions: {} });

  const list = await listSessionsPayload();
  const decorated = list.sessions.find((session) => session.id === sessionId);
  assert.equal("pinned" in decorated, false);
});

test("migrate unions the old browser lists and skips unknown ids", async () => {
  await PUT(putRequest(sessionId, { hidden: true }), params(sessionId));

  const response = await POST(new Request("http://localhost/api/session-preferences/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify({ pinned: [sessionId, ghostId], unread: [sessionId] }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual({ ok: body.ok, applied: body.applied, skipped: body.skipped }, {
    ok: true,
    applied: 2,
    skipped: 1,
  });
  assert.deepEqual(storedPrefs(), {
    version: 1,
    sessions: { [sessionId]: { hidden: true, pinned: true, unread: true } },
  });

  const invalid = await POST(new Request("http://localhost/api/session-preferences/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify({ pinned: "nope" }),
  }));
  assert.equal(invalid.status, 400);
});

test("a flag whose session disappeared outside pi-web is pruned on the next list", async () => {
  // Simulates a session deleted by the pi TUI or `rm`: the id is neither in the
  // catalogue nor resolvable, so keeping its flag would leak forever.
  writeFileSync(prefsPath, JSON.stringify({
    version: 1,
    sessions: { [ghostId]: { pinned: true }, [sessionId]: { pinned: true } },
  }));

  const list = await listSessionsPayload();
  assert.equal(list.sessions.some((session) => session.id === ghostId), false);
  assert.deepEqual(storedPrefs(), { version: 1, sessions: { [sessionId]: { pinned: true } } });
  // The real session keeps its flag: only unresolvable ids are dropped.
  assert.equal(list.sessions.find((session) => session.id === sessionId)?.pinned, true);
});
