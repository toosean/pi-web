import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

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

test("supports session pinning and persistence", () => {
  assert.match(source, /PINNED_SESSIONS_STORAGE_KEY = "pi-web:pinned-session-ids"/);
  assert.match(sessionItemSource, /onClick=\{handlePinClick\}/);
  assert.match(sessionItemSource, /isPinned \? t\("sidebar\.unpin"\) : t\("sidebar\.pin"\)/);
});
