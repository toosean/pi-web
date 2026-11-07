import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const useAgentSessionSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");

test("useAgentSession initializes models and thinking level from client cache", () => {
  assert.match(useAgentSessionSource, /import\s*\{[^}]*getCachedModelsData[^}]*setCachedModelsData[^}]*\}\s*from\s*["']@\/lib\/client-cache["']/);
  assert.match(useAgentSessionSource, /const\s*\[modelNames,\s*setModelNames\]\s*=\s*useState<Record<string,\s*string>>\(\(\)\s*=>\s*getCachedModelsData\(\)\?\.models\s*\?\?\s*\{\}\)/);
  assert.match(useAgentSessionSource, /const\s*\[modelList,\s*setModelList\]\s*=\s*useState<ModelEntry\[\]>\(\(\)\s*=>\s*\(getCachedModelsData\(\)\?\.modelList\s*\?\?\s*\[\]\) as ModelEntry\[\]\)/);
  assert.match(useAgentSessionSource, /setCachedModelsData\(\{/);
});

test("the sessions sidebar seeds its home directory from the client cache", () => {
  // v0.15.0 moved the folder picker out of the composer: the sidebar owns the
  // home directory now, so the cache seeds it there and is written back.
  assert.match(sidebarSource, /const \[homeDir, setHomeDir\] = useState<string>\(\(\) => getCachedHomeDir\(\) \?\? ""\)/);
  assert.match(sidebarSource, /setCachedHomeDir\(d\.home\)/);
  // The worktree list is cached per cwd, so the picker's next first paint has it.
  assert.match(sidebarSource, /setCachedWorktrees\(selectedCwd, d\.worktrees as never\)/);
});

// The sidebar no longer owns the home directory: the v0.12.0 rewrite moved the
// folder picker into components/ProjectWorktreePicker.tsx, and the cached home
// directory now only seeds ChatInput's picker (asserted above).
