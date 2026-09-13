import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_PENDING_SESSIONS,
  mergePendingSessions,
  prunePendingSessions,
  rememberPendingSession,
} = await jiti.import("./pending-session.ts");

function session(id, modified, extra = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/work/repo",
    created: modified,
    modified,
    messageCount: 2,
    firstMessage: "hello",
    ...extra,
  };
}

test("shows just-created sessions ahead of the server catalog", () => {
  const catalog = [session("old", "2026-09-01T00:00:00.000Z")];
  const pending = [
    session("new-a", "2026-09-02T00:00:00.000Z", { path: "", transient: true }),
    session("new-b", "2026-09-02T00:00:01.000Z", { path: "", transient: true }),
  ];

  const merged = mergePendingSessions(catalog, pending);

  assert.deepEqual(merged.map((s) => s.id), ["new-a", "new-b", "old"]);
  assert.equal(merged[0].transient, true);
});

test("server record replaces the pending snapshot once the catalog has it", () => {
  const catalog = [session("new", "2026-09-02T00:00:00.000Z")];
  const pending = [session("new", "2026-09-02T00:00:00.000Z", { path: "", transient: true })];

  const merged = mergePendingSessions(catalog, pending);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].path, "/sessions/new.jsonl");
  assert.equal(merged[0].transient, undefined);
});

test("keeping no snapshots leaves the catalog untouched", () => {
  const catalog = [session("old", "2026-09-01T00:00:00.000Z")];

  assert.equal(mergePendingSessions(catalog, null), catalog);
  assert.equal(mergePendingSessions(catalog, undefined), catalog);
  assert.equal(mergePendingSessions(catalog, []), catalog);
});

test("a snapshot survives the chat moving to another session", () => {
  // Selecting another session only changes the incoming snapshot: the one
  // already remembered must stay listed.
  const fresh = session("fresh", "2026-09-02T00:00:00.000Z", { path: "", transient: true });
  const remembered = rememberPendingSession([], fresh);
  const afterSwitch = rememberPendingSession(remembered, session("other", "2026-09-01T00:00:00.000Z"));

  assert.deepEqual(afterSwitch.map((s) => s.id), ["fresh", "other"]);
  assert.deepEqual(mergePendingSessions([], afterSwitch).map((s) => s.id), ["fresh", "other"]);
});

test("remembering the same id refreshes the snapshot in place", () => {
  const first = session("fresh", "2026-09-02T00:00:00.000Z", { path: "", transient: true, messageCount: 1 });
  const updated = session("fresh", "2026-09-02T00:00:05.000Z", { path: "", transient: true, messageCount: 3 });

  const remembered = rememberPendingSession(rememberPendingSession([], first), updated);

  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].messageCount, 3);
});

test("remembered snapshots are bounded", () => {
  let pending = [];
  for (let index = 0; index < MAX_PENDING_SESSIONS + 3; index += 1) {
    pending = rememberPendingSession(pending, session(`s${index}`, "2026-09-02T00:00:00.000Z"));
  }

  assert.equal(pending.length, MAX_PENDING_SESSIONS);
  assert.equal(pending.at(-1).id, `s${MAX_PENDING_SESSIONS + 2}`);
});

test("pruning drops snapshots the catalog now reports", () => {
  const pending = [session("listed"), session("still-pending")];
  const catalog = [session("listed")];

  const pruned = prunePendingSessions(pending, catalog);

  assert.deepEqual(pruned.map((s) => s.id), ["still-pending"]);
  // Nothing to prune keeps the same reference so React can bail out.
  assert.equal(prunePendingSessions(pending, []), pending);
  assert.equal(prunePendingSessions(pending, [session("unrelated")]), pending);
});
