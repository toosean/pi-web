import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const useAgentSessionSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const sessionSidebarSource = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");

test("useAgentSession initializes models and thinking level from client cache", () => {
  assert.match(useAgentSessionSource, /import\s*\{[^}]*getCachedModelsData[^}]*setCachedModelsData[^}]*\}\s*from\s*["']@\/lib\/client-cache["']/);
  assert.match(useAgentSessionSource, /const\s*\[modelNames,\s*setModelNames\]\s*=\s*useState<Record<string,\s*string>>\(\(\)\s*=>\s*getCachedModelsData\(\)\?\.models\s*\?\?\s*\{\}\)/);
  assert.match(useAgentSessionSource, /const\s*\[modelList,\s*setModelList\]\s*=\s*useState<ModelEntry\[\]>\(\(\)\s*=>\s*getCachedModelsData\(\)\?\.modelList\s*\?\?\s*\[\]\)/);
  assert.match(useAgentSessionSource, /setCachedModelsData\(\{/);
});

test("ChatInput initializes projects, home directory, and worktrees from client cache", () => {
  assert.match(chatInputSource, /import\s*\{[^}]*getCachedHomeDir[^}]*\}\s*from\s*["']@\/lib\/client-cache["']/);
  assert.match(chatInputSource, /const\s*\[recentProjects,\s*setRecentProjects\]\s*=\s*useState<string\[\]>\(\(\)\s*=>\s*\{[\s\S]*?getCachedRecentProjects\(\)/);
  assert.match(chatInputSource, /const\s*\[homeDir,\s*setHomeDir\]\s*=\s*useState<string>\(\(\)\s*=>\s*getCachedHomeDir\(\)\s*\?\?\s*""\)/);
  assert.match(chatInputSource, /const\s*\[worktrees,\s*setWorktrees\]\s*=\s*useState<\{[\s\S]*?\}\[\]>\(\(\)\s*=>\s*\{[\s\S]*?getCachedWorktrees\(newSessionCwd\)/);
  assert.match(chatInputSource, /setCachedHomeDir\(d\.home\)/);
  assert.match(chatInputSource, /setCachedRecentProjects\(sorted\)/);
  assert.match(chatInputSource, /setCachedWorktrees\(newSessionCwd,\s*list\)/);
});

test("SessionSidebar uses cached home directory on mount", () => {
  assert.match(sessionSidebarSource, /const\s*\[homeDir,\s*setHomeDir\]\s*=\s*useState<string>\(\(\)\s*=>\s*getCachedHomeDir\(\)\s*\?\?\s*""\)/);
  assert.match(sessionSidebarSource, /setCachedHomeDir\(d\.home\)/);
});
