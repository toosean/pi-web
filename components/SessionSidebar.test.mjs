import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { flattenSessionTreeRows, getSessionListIndices } = await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / 54);
    const lastVisible = Math.ceil((scrollTop + 335) / 54) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, 24);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, 23);
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, 23);
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, 28);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("restores the persisted session view mode after hydration", () => {
  assert.match(
    source,
    /useState<"project" \| "flat">\("project"\)/,
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*?localStorage\.getItem\("pi-session-view-mode"\)[\s\S]*?setSessionViewMode\(saved\);[\s\S]*?\}, \[\]\);/,
  );
});

test("persists session flags through the server instead of localStorage", () => {
  // Pin / hide / unread live in ~/.pi-web/session-preferences.json (see
  // lib/session-preferences.ts). The old per-browser keys are only read once, to
  // migrate them, and never written again.
  assert.doesNotMatch(source, /localStorage\.setItem\(LEGACY_/);
  assert.match(source, /const LEGACY_PINNED_SESSIONS_STORAGE_KEY = "pi-web:pinned-session-ids"/);
  assert.match(source, /fetch\("\/api\/session-preferences\/migrate"/);
  assert.match(
    source,
    /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(update\.id\)\}\/prefs`[\s\S]*?body: JSON\.stringify\(\{ \[flag\]: update\.value \}\)/,
  );
  assert.match(source, /syncSessionFlag\("pinned", pinnedSessionIds\)/);
  assert.match(source, /syncSessionFlag\("hidden", hiddenSessionIds\)/);
  assert.match(source, /syncSessionFlag\("unread", unreadSessionIds\)/);
  assert.match(sessionItemSource, /onClick=\{handlePinClick\}/);
  assert.match(sessionItemSource, /isPinned \? t\("sidebar\.unpin"\) : t\("sidebar\.pin"\)/);
});

test("adopts server flags without clobbering an in-flight write", () => {
  assert.match(
    source,
    /if \(pendingFlagWritesRef\.current\[flag\] > 0\) continue;/,
  );
  assert.match(source, /adoptServerFlags\(serverFlags\)/);
  assert.match(source, /if \(session\.pinned\) serverFlags\.pinned\.add\(session\.id\)/);
  assert.match(source, /if \(session\.hidden\) serverFlags\.hidden\.add\(session\.id\)/);
  assert.match(
    source,
    /session\.unread && session\.relation\?\.kind !== "subagent"\) serverFlags\.unread\.add/,
  );
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(visibleSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /session\.unread && session\.relation\?\.kind !== "subagent"\) serverFlags\.unread\.add/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\(hovered \|\| menuOpen\) && !session\.transient && \(/);
});

test("renders the local session tree through the virtualized fixed-height row model", () => {
  assert.match(source, /buildSessionTree\(filteredSessions, pinnedSessionIds\)/);
  assert.match(source, /flattenSessionTreeRows\(sessionTree, collapsedSessionIds\)/);
  assert.match(source, /height: flattenedSessionRows\.length \* SESSION_LIST_ITEM_HEIGHT/);
  assert.match(source, /function SessionTreeItem/);
  assert.match(source, /const interactionActive = renaming \|\| menuOpen \|\| confirmDelete \|\| deleting \|\| dragging/);
  assert.match(source, /interactionIndex >= 0 && !indices\.includes\(interactionIndex\)/);
});

test("flattens thousand-row trees and removes collapsed descendants without changing depth", () => {
  const root = { session: { id: "root" }, children: [] };
  let parent = root;
  for (let index = 1; index < 1_000; index++) {
    const child = { session: { id: `session-${index}` }, children: [] };
    parent.children.push(child);
    parent = child;
  }

  const expanded = flattenSessionTreeRows([root], new Set());
  assert.equal(expanded.length, 1_000);
  assert.equal(expanded[999].depth, 999);
  assert.equal(expanded[0].hasChildren, true);

  const collapsed = flattenSessionTreeRows([root], new Set(["root"]));
  assert.deepEqual(collapsed.map((row) => row.node.session.id), ["root"]);
  assert.deepEqual(getSessionListIndices(collapsed.length, 50_000, 335), [0]);
});

test("renders a just-created session before the catalog scan reports it", () => {
  assert.match(source, /pendingSession\?: SessionInfo \| null;/);
  assert.match(source, /selectedSessionId, pendingSession, onSelectSession/);
  assert.match(
    source,
    /const visibleSessions = useMemo\(\s*\(\) => mergePendingSessions\(allSessions, pendingRows\),\s*\[allSessions, pendingRows\],\s*\);/,
  );
  // The rendered list, project groups, and reported catalog all come from the merge.
  assert.match(source, /sessionsForProject\(visibleSessions, selectedProject\.key\)/);
  assert.match(source, /getRecentProjects\(visibleSessions\)/);
  assert.match(source, /onSessionsChange\?\.\(visibleSessions\)/);
});

test("a created session keeps its row when the chat moves to another session", () => {
  // The snapshot is remembered per id instead of being read from the session
  // that happens to be open, so selecting another session cannot retract it.
  assert.match(source, /setPendingSessions\(\(previous\) => rememberPendingSession\(previous, pendingSession\)\)/);
  assert.match(source, /setPendingSessions\(\(previous\) => prunePendingSessions\(previous, allSessions\)\)/);
  assert.match(source, /\}, \[pendingSession\]\);/);
  assert.match(source, /\}, \[allSessions\]\);/);
});

test("gives a client-built session the identity of its project before hydration", () => {
  assert.match(
    source,
    /const project = projectFor\(session\.cwd\);\s*return project\s*\? \{ \.\.\.session, projectRoot: project\.root, projectKey: project\.key \}/,
  );
});

test("hands the app's open session to the sidebar", async () => {
  const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShell, /pendingSession=\{selectedSession\}/);
});
