import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appShellSource = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = fs.readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const agentSessionSource = fs.readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("renders one mounted window per visited session instead of remounting a single chat", () => {
  assert.match(appShellSource, /const \[sessionWindows, setSessionWindows\] = useState<SessionWindow\[\]>\(\[\]\)/);
  assert.match(appShellSource, /const selectedSession = activeWindow\?\.session \?\? null/);
  assert.match(appShellSource, /sessionWindows\.map\(\(window\) => \(/);
  assert.match(appShellSource, /key=\{window\.windowId\}/);
  assert.match(appShellSource, /isActive=\{window\.windowId === activeWindowId\}/);
  // No remount key may survive on the chat stack: the registry owns identity.
  assert.doesNotMatch(appShellSource, /key=\{sessionKey\}/);
  assert.doesNotMatch(appShellSource, /setSessionKey/);
});

test("hidden windows keep their DOM but skip layout", () => {
  assert.match(appShellSource, /contentVisibility: window\.windowId === activeWindowId \? "visible" : "hidden"/);
  assert.match(appShellSource, /containIntrinsicSize: "100% 100%"/);
  assert.match(appShellSource, /aria-hidden=\{window\.windowId !== activeWindowId\}/);
  // A hidden wrapper's own box still hit-tests and wrappers are stacked in visit
  // order, so without `pointer-events: none` a background window swallows clicks
  // and wheel events aimed at the front one (input box unusable, no scrolling).
  assert.match(appShellSource, /pointerEvents: window\.windowId === activeWindowId \? "auto" : "none"/);
  // No z-index: the chat column does not create a stacking context, so raising
  // the front window would paint the chat above the mobile sidebar drawer.
  assert.doesNotMatch(appShellSource, /zIndex: window\.windowId === activeWindowId/);
});

test("retention uses the pure policy with a draft-aware busy set", () => {
  assert.match(appShellSource, /selectDestroyableWindowIds\(sessionWindowsRef\.current, \{/);
  assert.match(appShellSource, /idleMs: resolveSessionWindowIdleMs\(storage\)/);
  assert.match(appShellSource, /maxWindows: isMobile \? MAX_MOBILE_SESSION_WINDOWS : MAX_SESSION_WINDOWS/);
  assert.match(appShellSource, /maxDrafts: MAX_DRAFT_WINDOWS/);
  // Unsent drafts protect a window without pinning it: they are passed as draft
  // keys, never reported as `busy`.
  assert.match(appShellSource, /draftKeysWithContent,/);
  assert.match(appShellSource, /filter\(\(window\) => Boolean\(getDraft\(window\.draftKey\)\)\)/);
  assert.match(appShellSource, /const timer = setInterval\(sweepSessionWindows, SESSION_WINDOW_SWEEP_MS\)/);
});

test("a window reports its own interaction state", () => {
  assert.match(chatWindowSource, /const windowBusy = loading/);
  assert.match(chatWindowSource, /\|\| forkingEntryId !== null/);
  assert.match(chatWindowSource, /\|\| extensionDialog !== null/);
  assert.match(chatWindowSource, /onWindowBusyChange\?\.\(windowBusy\)/);
  assert.match(appShellSource, /setWindowBusy\(previous, windowId, busy, Date\.now\(\)\)/);
});

test("promoting a fresh composer keeps its window id and its stream", () => {
  assert.match(appShellSource, /promoteWindow\(previous, windowId, \{ session, now \}\)/);
  assert.match(appShellSource, /if \(!window \|\| window\.sessionId !== null\) return/);
  // The composer handle only follows the front window.
  assert.match(appShellSource, /if \(activeWindowIdRef\.current !== windowId\) return;[\s\S]*?chatInputRef\.current = handle/);
});

test("per-window callbacks are stable and cannot be written by a background window", () => {
  assert.match(appShellSource, /const getWindowCallbacks = useCallback\(\(windowId: string\): ChatWindowCallbacks => \{/);
  assert.match(appShellSource, /\.\.\.getWindowCallbacks\(window\.windowId\)/);
  for (const handler of [
    "handleBranchDataChange",
    "handleSystemPromptChange",
    "handleSystemToolsChange",
    "handleSystemInfoLoaderChange",
    "handleSessionStatsChange",
    "handleContextUsageChange",
  ]) {
    assert.match(
      appShellSource,
      new RegExp(`const ${handler} = useCallback\\(\\(windowId: string[\\s\\S]*?if \\(!isActiveWindow\\(windowId\\)\\) return;`),
      `${handler} must ignore background windows`,
    );
  }
  // ChatWindow stops forwarding while it is behind, and re-emits on activation.
  assert.match(chatWindowSource, /onSystemToolsChange\?\.\(lastToolsRef\.current\)/);
  assert.match(chatWindowSource, /if \(!isActive\) return;\n    onSessionStatsChange\?\.\(sessionStatsRef\.current\)/);
});

test("completions are reported by the window that finished, not the front one", () => {
  assert.match(appShellSource, /const handleAgentEnd = useCallback\(\(windowId: string\) => \{/);
  assert.match(appShellSource, /const finishedSession = getSessionWindow\(sessionWindowsRef\.current, windowId\)\?\.session \?\? null/);
  assert.match(appShellSource, /const handleAttentionNeeded = useCallback\(\(windowId: string, request: BlockingExtensionUiRequest\) => \{/);
  assert.match(appShellSource, /onAgentEnd: \(\) => handlers\.onAgentEnd\(windowId\)/);
});

test("only the front window owns the global Esc shortcut", () => {
  assert.match(chatWindowSource, /registerAbortHandler\(windowId, sessionBusy \? handleAbort : null\)/);
  assert.match(chatWindowSource, /registerAbortHandler\(windowId, null\)/);
  assert.match(appShellSource, /setAbortHandlerOwner\(activeWindowId\)/);
  assert.match(appShellSource, /retainAbortHandlers\(live\)/);
});

test("event streams are budgeted so mounted windows cannot exhaust the connection pool", () => {
  assert.match(appShellSource, /const MAX_EVENT_STREAMS = 3/);
  assert.match(appShellSource, /const streamAllowedWindowIds = useMemo\(\(\) => \{/);
  assert.match(appShellSource, /allowEventStream=\{streamAllowedWindowIds\.has\(window\.windowId\)\}/);
  // The hook must both refuse new streams and release one it no longer owns.
  assert.match(agentSessionSource, /if \(!allowEventStreamRef\.current\) return Promise\.resolve\(\)/);
  assert.match(agentSessionSource, /if \(!allowEventStreamRef\.current\) return;\n    eventConnectionRef\.current!\.maintain\(sid\)/);
  assert.match(agentSessionSource, /if \(!allowEventStream\) \{\n      cancelEventStreamGrace\(\);\n      closeEvents\(\);/);
});

test("coming back to the front revalidates without remounting", () => {
  assert.match(agentSessionSource, /const wasActive = isActiveRef\.current;/);
  assert.match(agentSessionSource, /if \(!isActive \|\| wasActive\) return;/);
  // A running window only reconciles; re-fetching would clobber streamed messages.
  assert.match(agentSessionSource, /if \(agentRunningRef\.current \|\| bashRunningRef\.current\) \{[\s\S]*?reconcileAgentState\(sid\);[\s\S]*?return;\n    \}\n    void loadSession\(sid, false, true, true, false\)/);
  assert.match(agentSessionSource, /revalidateOnCacheHit = true,/);
});

test("hidden windows do not run layout-dependent work", () => {
  assert.match(chatWindowSource, /if \(!agentRunning \|\| !promptAnchorActive \|\| !isActive\) \{/);
  assert.match(chatWindowSource, /\{isMobile \|\| !isActive \? null : \(/);
});
