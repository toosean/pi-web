import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DRAFT_WINDOWS,
  MAX_SESSION_WINDOWS,
  SESSION_WINDOW_IDLE_MS,
  SESSION_WINDOW_IDLE_OVERRIDE_KEY,
  SESSION_WINDOW_SWEEP_MS,
  activateWindow,
  findWindowBySessionId,
  getWindow,
  makeWindowId,
  openDraftWindow,
  openSessionWindow,
  promoteWindow,
  removeWindow,
  removeWindowBySessionId,
  resolveSessionWindowIdleMs,
  selectDestroyableWindowIds,
  setWindowBusy,
  updateWindow,
} from "./session-windows.ts";

const MINUTE = 60 * 1000;

function session(id, cwd = "/repo") {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd,
    name: id,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hi",
  };
}

function openSession(windows, id, now, cwd) {
  return openSessionWindow(windows, { windowId: `w-${id}`, session: session(id, cwd), now });
}

function baseOptions(windows, overrides = {}) {
  return {
    now: 0,
    activeWindowId: null,
    idleMs: SESSION_WINDOW_IDLE_MS,
    maxWindows: MAX_SESSION_WINDOWS,
    maxDrafts: MAX_DRAFT_WINDOWS,
    ...overrides,
  };
}

test("openSessionWindow appends a window and reuses it on revisit", () => {
  const first = openSession([], "a", 1000);
  assert.equal(first.windows.length, 1);
  assert.equal(first.windows[0].sessionId, "a");
  assert.equal(first.windows[0].draftKey, "a");
  assert.equal(first.windows[0].lastActiveAt, 1000);

  const again = openSessionWindow(first.windows, {
    windowId: "w-ignored",
    session: { ...session("a"), name: "renamed" },
    now: 5000,
  });
  assert.equal(again.windows.length, 1, "same session must not create a second window");
  assert.equal(again.windowId, "w-a", "the existing windowId is preserved");
  assert.equal(again.windows[0].session.name, "renamed");
  assert.equal(again.windows[0].lastActiveAt, 5000);
});

test("openDraftWindow reuses the draft window of the same cwd", () => {
  const first = openDraftWindow([], { windowId: "d1", draftKey: "new:d1:/repo", cwd: "/repo", now: 10 });
  const again = openDraftWindow(first.windows, {
    windowId: "d2",
    draftKey: "new:d2:/repo",
    cwd: "/repo",
    now: 20,
  });
  assert.equal(again.windows.length, 1);
  assert.equal(again.windowId, "d1");
  assert.equal(again.windows[0].draftKey, "new:d2:/repo", "the freshest draft key wins");
  assert.equal(again.windows[0].lastActiveAt, 20);

  const other = openDraftWindow(again.windows, {
    windowId: "d3",
    draftKey: "new:d3:/other",
    cwd: "/other",
    now: 30,
  });
  assert.equal(other.windows.length, 2, "a different cwd gets its own draft window");
});

test("activateWindow / updateWindow / removeWindow helpers", () => {
  let { windows } = openSession([], "a", 0);
  ({ windows } = openSession(windows, "b", 0));

  const activated = activateWindow(windows, "w-b", 42);
  assert.equal(getWindow(activated, "w-b").lastActiveAt, 42);
  assert.equal(getWindow(activated, "w-a").lastActiveAt, 0);

  const patched = updateWindow(activated, "w-a", { busy: true });
  assert.equal(getWindow(patched, "w-a").busy, true);

  assert.equal(removeWindow(patched, "w-a").length, 1);
  assert.equal(removeWindowBySessionId(patched, "a").length, 1);
});

test("setWindowBusy restarts the idle countdown when a window becomes idle", () => {
  let { windows } = openSession([], "a", 0);
  windows = setWindowBusy(windows, "w-a", true, 10 * MINUTE);
  assert.equal(getWindow(windows, "w-a").lastActiveAt, 0, "becoming busy must not touch the clock");

  windows = setWindowBusy(windows, "w-a", false, 20 * MINUTE);
  assert.equal(getWindow(windows, "w-a").busy, false);
  assert.equal(getWindow(windows, "w-a").lastActiveAt, 20 * MINUTE,
    "a run that just finished gives the window a fresh idle window");

  // Staying idle must not keep pushing the clock forward.
  windows = setWindowBusy(windows, "w-a", false, 30 * MINUTE);
  assert.equal(getWindow(windows, "w-a").lastActiveAt, 20 * MINUTE);
});

test("promoteWindow keeps the windowId so the live instance survives", () => {
  const { windows } = openDraftWindow([], { windowId: "d1", draftKey: "new:d1:/repo", cwd: "/repo", now: 0 });
  const promoted = promoteWindow(windows, "d1", { session: session("real"), now: 50 });
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].windowId, "d1");
  assert.equal(promoted[0].sessionId, "real");
  assert.equal(promoted[0].draftKey, "real");
  assert.equal(promoted[0].lastActiveAt, 50);
});

test("promoteWindow collapses a duplicate window for the same session", () => {
  let { windows } = openDraftWindow([], { windowId: "d1", draftKey: "new:d1:/repo", cwd: "/repo", now: 0 });
  ({ windows } = openSession(windows, "real", 1));
  const promoted = promoteWindow(windows, "d1", { session: session("real"), now: 50 });
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].windowId, "d1", "the promoted composer instance wins");
});

test("idle timeout evicts only windows that are not in front, busy, or holding a draft", () => {
  let windows = [];
  ({ windows } = openSession(windows, "a", 0));
  ({ windows } = openSession(windows, "b", 1 * MINUTE));
  ({ windows } = openSession(windows, "c", 2 * MINUTE));
  ({ windows } = openSession(windows, "d", 3 * MINUTE));
  windows = setWindowBusy(windows, "w-d", true, 3 * MINUTE);
  windows = updateWindow(windows, "w-b", { draftKey: "b" });

  const now = 11 * MINUTE;
  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now,
    activeWindowId: "w-d",
    draftKeysWithContent: ["b"],
  }));
  assert.deepEqual(destroyable, ["w-a"], "only the plain idle window is evictable");
});

test("hard cap evicts oldest session windows and never the front window", () => {
  let windows = [];
  for (let i = 0; i < 12; i += 1) {
    ({ windows } = openSession(windows, `s${i}`, i * MINUTE));
  }
  const active = "w-s0";
  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 30 * MINUTE,
    activeWindowId: active,
    idleMs: 24 * 60 * MINUTE,
    maxWindows: 4,
  }));
  assert.equal(destroyable.length, 8, "12 windows down to the cap of 4");
  assert.ok(!destroyable.includes(active), "the front window is never evicted");
  assert.equal(findWindowBySessionId(windows, "s1").windowId, destroyable[0], "oldest first");
});

test("hard cap leaves busy windows alone even when that exceeds the cap", () => {
  let windows = [];
  for (let i = 0; i < 6; i += 1) {
    ({ windows } = openSession(windows, `s${i}`, i * MINUTE));
    windows = setWindowBusy(windows, `w-s${i}`, true, i * MINUTE);
  }
  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 60 * MINUTE,
    activeWindowId: null,
    maxWindows: 2,
  }));
  assert.deepEqual(destroyable, [], "nothing may be evicted while everything is busy");
});

test("busy windows are not evicted by the idle timeout", () => {
  let { windows } = openSession([], "a", 0);
  windows = setWindowBusy(windows, "w-a", true, 0);
  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 60 * MINUTE,
    idleMs: MINUTE,
  }));
  assert.deepEqual(destroyable, []);
});

test("clock jumps backwards do not evict everything", () => {
  let { windows } = openSession([], "a", 10 * MINUTE);
  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 1 * MINUTE,
    idleMs: MINUTE,
  }));
  assert.deepEqual(destroyable, []);
});

test("draft cap is the only rule that may evict a draft window holding text", () => {
  let windows = [];
  ({ windows } = openDraftWindow(windows, { windowId: "d1", draftKey: "k1", cwd: "/a", now: 0 }));
  ({ windows } = openDraftWindow(windows, { windowId: "d2", draftKey: "k2", cwd: "/b", now: MINUTE }));
  ({ windows } = openDraftWindow(windows, { windowId: "d3", draftKey: "k3", cwd: "/c", now: 2 * MINUTE }));

  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 60 * MINUTE,
    maxDrafts: 2,
    draftKeysWithContent: ["k1", "k2", "k3"],
  }));
  assert.deepEqual(destroyable, ["d1"], "oldest draft window is recycled, newest two stay");

  // The active draft window is still protected.
  const withActive = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 60 * MINUTE,
    activeWindowId: "d1",
    maxDrafts: 2,
    draftKeysWithContent: ["k1", "k2", "k3"],
  }));
  assert.deepEqual(withActive, ["d2"]);
});

test("draft windows never consume the session window cap", () => {
  let windows = [];
  for (let i = 0; i < MAX_SESSION_WINDOWS; i += 1) {
    ({ windows } = openSession(windows, `s${i}`, i * MINUTE));
  }
  ({ windows } = openDraftWindow(windows, { windowId: "d1", draftKey: "k1", cwd: "/repo2", now: 9 * MINUTE }));

  const destroyable = selectDestroyableWindowIds(windows, baseOptions(windows, {
    now: 9 * MINUTE + 1000,
  }));
  assert.deepEqual(destroyable, [], "the draft window fills a slot of its own");
});

test("resolveSessionWindowIdleMs honours a valid override and rejects junk", () => {
  const storage = (value) => ({ getItem: (key) => (key === SESSION_WINDOW_IDLE_OVERRIDE_KEY ? value : null) });

  assert.equal(resolveSessionWindowIdleMs(storage("5000")), 5000);
  assert.equal(resolveSessionWindowIdleMs(storage("0")), SESSION_WINDOW_IDLE_MS);
  assert.equal(resolveSessionWindowIdleMs(storage("999")), SESSION_WINDOW_IDLE_MS);
  assert.equal(resolveSessionWindowIdleMs(storage("abc")), SESSION_WINDOW_IDLE_MS);
  assert.equal(resolveSessionWindowIdleMs(storage(null)), SESSION_WINDOW_IDLE_MS);
  assert.equal(resolveSessionWindowIdleMs(null), SESSION_WINDOW_IDLE_MS);
  assert.equal(resolveSessionWindowIdleMs({ getItem() { throw new Error("blocked"); } }), SESSION_WINDOW_IDLE_MS);
});

test("sweep runs well before the idle timeout so eviction is timely", () => {
  assert.ok(SESSION_WINDOW_SWEEP_MS > 0);
  assert.ok(SESSION_WINDOW_SWEEP_MS <= SESSION_WINDOW_IDLE_MS / 10);
});

test("makeWindowId returns distinct ids", () => {
  const ids = new Set(Array.from({ length: 50 }, () => makeWindowId()));
  assert.equal(ids.size, 50);
});

test("window shape stays serialisable for debugging", () => {
  const { windows } = openSession([], "a", 0);
  assert.deepEqual(Object.keys(windows[0]).sort(), [
    "busy", "cwd", "draftKey", "lastActiveAt", "session", "sessionId", "windowId",
  ]);
});
