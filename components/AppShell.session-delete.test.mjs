import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function handleSessionDeletedBody() {
  const start = source.indexOf("  const handleSessionDeleted = useCallback");
  const end = source.indexOf("  const handleOpenFile = useCallback", start);
  assert.notEqual(start, -1, "handleSessionDeleted callback not found");
  assert.notEqual(end, -1, "handleOpenFile callback not found after handleSessionDeleted");
  return source.slice(start, end);
}

/**
 * Runs the real callback in a vm sandbox against this fork's window registry:
 * a delete removes the deleted session's mounted window, and only a window that
 * was in front falls back to a fresh composer for its cwd.
 */
function runHandleSessionDeleted(windows, activeWindowId) {
  const state = {
    refreshBumped: false,
    draftWindowsEnsured: [],
    activeWindowId: undefined,
    windowsAfter: null,
    routerReplaced: null,
  };
  const context = vm.createContext({
    crypto: globalThis.crypto,
    window: { location: { pathname: "/", search: "" } },
    router: { replace: (url) => { state.routerReplaced = url; } },
    sessionWindowsRef: { current: windows },
    invalidateWorkspaceRestore() {},
    setRefreshKey: () => { state.refreshBumped = true; },
    findWindowBySessionId: (list, id) => (list ?? []).find((w) => w.session?.id === id) ?? null,
    removeWindowBySessionId: (list, id) => (list ?? []).filter((w) => w.session?.id !== id),
    isActiveWindow: (windowId) => windowId === activeWindowId,
    setSessionWindows: (update) => { state.windowsAfter = update(windows); },
    setActiveWindowId: (value) => { state.activeWindowId = value; },
    ensureDraftWindowForCwd: (cwd) => { state.draftWindowsEnsured.push(cwd); },
    setBranchTree() {},
    setBranchActiveLeafId() {},
    setSystemPrompt() {},
    setSystemTools() {},
    setSystemInfoLoading() {},
    setActiveTopPanel() {},
    useCallback: (callback) => callback,
  });
  vm.runInContext(stripTypeScriptTypes(`${handleSessionDeletedBody()}
    handleSessionDeleted("gone-session");
  `), context);
  return state;
}

test("deleting a background window keeps the front chat and the URL", () => {
  const deleting = { windowId: "w1", cwd: "/project-a", session: { id: "gone-session", cwd: "/project-a" } };
  const front = { windowId: "w2", cwd: "/project-b", session: { id: "next-session", cwd: "/project-b" } };
  const state = runHandleSessionDeleted([deleting, front], front.windowId);

  assert.equal(state.refreshBumped, true, "sidebar list still refreshes");
  assert.deepEqual(state.windowsAfter.map((w) => w.windowId), ["w2"], "only the deleted window goes");
  assert.deepEqual(state.draftWindowsEnsured, [], "the front composer is left alone");
  assert.equal(state.activeWindowId, undefined, "nothing takes the front");
  assert.equal(state.routerReplaced, null, "URL does not move");
});

test("deleting the window in front falls back to a fresh composer for its cwd", () => {
  const deleting = { windowId: "w1", cwd: "/project-a", session: { id: "gone-session", cwd: "/project-a" } };
  const state = runHandleSessionDeleted([deleting], deleting.windowId);

  assert.equal(state.refreshBumped, true);
  assert.deepEqual(state.windowsAfter, [], "the window is gone");
  assert.deepEqual(state.draftWindowsEnsured, ["/project-a"], "a fresh composer takes its place");
  assert.equal(state.routerReplaced, "/", "the URL drops the deleted session");
});

test("deleting a window that was already gone changes nothing but the list", () => {
  const front = { windowId: "w2", cwd: "/project-b", session: { id: "next-session", cwd: "/project-b" } };
  const state = runHandleSessionDeleted([front], front.windowId);

  assert.equal(state.refreshBumped, true);
  assert.equal(state.windowsAfter, null, "no window list update");
  assert.deepEqual(state.draftWindowsEnsured, []);
  assert.equal(state.routerReplaced, null);
});
