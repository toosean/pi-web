import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("hooks up useMobileHistoryNavigation in AppShell", () => {
  assert.match(
    source,
    /import\s+\{\s*useMobileHistoryNavigation\s*\}\s+from\s+["']@\/hooks\/useMobileHistoryNavigation["']/,
  );
  assert.match(
    source,
    /useMobileHistoryNavigation\(\{\s*isMobile,\s*sidebarOpen,\s*rightPanelOpen,\s*setSidebarOpen,\s*setRightPanelOpen,\s*\}\)/,
  );
});

test("uses mobile history methods for file open and close actions", () => {
  // handleOpenFile calls openMobileFile on mobile
  assert.match(source, /if\s*\(isMobile\)\s*\{\s*openMobileFile\(\);\s*\}\s*else\s*\{\s*setRightPanelOpen\(true\);\s*\}/);

  // handleCloseFileTab calls closeMobileFile on mobile when last tab is closed
  assert.match(source, /if\s*\(isMobile\)\s*\{\s*closeMobileFile\(\);\s*\}\s*else\s*\{\s*setRightPanelOpen\(false\);\s*\}/);

  // File panel close button uses closeMobileFile on mobile
  assert.match(source, /onClick=\{isMobile \? closeMobileFile : \(\) => setRightPanelOpen\(false\)\}/);
});

test("uses mobile history methods for session selection and sidebar toggling", () => {
  // Session selection closes sidebar via mobile history helper
  assert.match(source, /if\s*\(isMobile && !isRestore\)\s*selectMobileSession\(\);/);

  // New session closes sidebar via mobile history helper
  assert.match(source, /if\s*\(isMobile\)\s*selectMobileSession\(\);/);

  // Sidebar toggle delegates to toggleMobileSidebar on mobile
  assert.match(source, /if\s*\(isMobile\)\s*\{\s*setActiveTopPanel\(null\);\s*setMobileToolbarMoreOpen\(false\);\s*toggleMobileSidebar\(\);\s*return;\s*\}/);

  // Sidebar backdrop uses closeMobileSidebar on mobile
  assert.match(source, /onClick=\{isMobile \? closeMobileSidebar : \(\) => setSidebarOpen\(false\)\}/);
});
