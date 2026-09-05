import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getCachedModelsData,
  setCachedModelsData,
  getCachedHomeDir,
  setCachedHomeDir,
  getCachedRecentProjects,
  setCachedRecentProjects,
  getCachedWorktrees,
  setCachedWorktrees,
} = await jiti.import("./client-cache.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("models cache round-trips valid models data", () => {
  const storage = createStorage();
  const sample = {
    models: { "claude-sonnet": "Claude 3.7 Sonnet" },
    modelList: [{ id: "claude-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" }],
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet" },
    thinkingLevels: { "anthropic:claude-sonnet": ["off", "low", "medium", "high"] },
    thinkingLevelMaps: { "anthropic:claude-sonnet": { off: null, low: "low" } },
    thinkingLevelPins: { "anthropic/claude-sonnet": "high" },
  };

  assert.equal(getCachedModelsData(storage), null);
  setCachedModelsData(sample, storage);
  const loaded = getCachedModelsData(storage);
  assert.ok(loaded);
  assert.deepEqual(loaded.models, sample.models);
  assert.deepEqual(loaded.modelList, sample.modelList);
  assert.deepEqual(loaded.defaultModel, sample.defaultModel);
  assert.deepEqual(loaded.thinkingLevels, sample.thinkingLevels);
  assert.deepEqual(loaded.thinkingLevelMaps, sample.thinkingLevelMaps);
  assert.deepEqual(loaded.thinkingLevelPins, sample.thinkingLevelPins);
  assert.equal(typeof loaded.updatedAt, "number");
});

test("models cache safely rejects invalid or corrupted data", () => {
  assert.equal(getCachedModelsData(null), null);
  assert.equal(getCachedModelsData(createStorage({ "pi-web:cached-models": "invalid-json{" })), null);
  assert.equal(getCachedModelsData(createStorage({ "pi-web:cached-models": JSON.stringify("not-an-object") })), null);
  assert.equal(getCachedModelsData(createStorage({ "pi-web:cached-models": JSON.stringify([]) })), null);
  // Missing models or modelList
  assert.equal(getCachedModelsData(createStorage({ "pi-web:cached-models": JSON.stringify({ models: "not-an-object" }) })), null);
  assert.equal(getCachedModelsData(createStorage({ "pi-web:cached-models": JSON.stringify({ models: {}, modelList: "not-an-array" }) })), null);
});

test("home directory cache round-trips and rejects empty values", () => {
  const storage = createStorage();
  assert.equal(getCachedHomeDir(storage), null);
  setCachedHomeDir("/root", storage);
  assert.equal(getCachedHomeDir(storage), "/root");

  // Setting empty does not write
  setCachedHomeDir("", storage);
  assert.equal(getCachedHomeDir(storage), "/root");
});

test("recent projects cache round-trips and sanitizes list", () => {
  const storage = createStorage();
  assert.equal(getCachedRecentProjects(storage), null);

  const projects = ["/root/workspace/proj1", "/root/workspace/proj2"];
  setCachedRecentProjects(projects, storage);
  assert.deepEqual(getCachedRecentProjects(storage), projects);

  // Corrupted json
  assert.equal(getCachedRecentProjects(createStorage({ "pi-web:cached-recent-projects": "{" })), null);
  assert.equal(getCachedRecentProjects(createStorage({ "pi-web:cached-recent-projects": JSON.stringify("not-an-array") })), null);
  assert.equal(getCachedRecentProjects(createStorage({ "pi-web:cached-recent-projects": JSON.stringify([]) })), null);
});

test("worktrees cache isolates by cwd and round-trips", () => {
  const storage = createStorage();
  const cwd1 = "/root/workspace/proj1";
  const cwd2 = "/root/workspace/proj2";

  const wt1 = [{ path: "/root/workspace/proj1", branch: "main", isMain: true }];
  const wt2 = [{ path: "/root/workspace/proj2", branch: "feat", isMain: false }];

  setCachedWorktrees(cwd1, wt1, storage);
  setCachedWorktrees(cwd2, wt2, storage);

  assert.deepEqual(getCachedWorktrees(cwd1, storage), wt1);
  assert.deepEqual(getCachedWorktrees(cwd2, storage), wt2);
  assert.equal(getCachedWorktrees("/nonexistent", storage), null);
});

test("storage operations never throw when storage is null or throws", () => {
  const throwingStorage = {
    getItem() { throw new Error("Storage quota exceeded"); },
    setItem() { throw new Error("Storage quota exceeded"); },
    removeItem() { throw new Error("Storage quota exceeded"); },
  };

  assert.doesNotThrow(() => {
    assert.equal(getCachedModelsData(null), null);
    assert.equal(getCachedModelsData(throwingStorage), null);
    setCachedModelsData({ models: {}, modelList: [], defaultModel: null }, null);
    setCachedModelsData({ models: {}, modelList: [], defaultModel: null }, throwingStorage);

    assert.equal(getCachedHomeDir(null), null);
    assert.equal(getCachedHomeDir(throwingStorage), null);
    setCachedHomeDir("/root", null);
    setCachedHomeDir("/root", throwingStorage);

    assert.equal(getCachedRecentProjects(null), null);
    assert.equal(getCachedRecentProjects(throwingStorage), null);
    setCachedRecentProjects(["/root"], null);
    setCachedRecentProjects(["/root"], throwingStorage);

    assert.equal(getCachedWorktrees("/root", null), null);
    assert.equal(getCachedWorktrees("/root", throwingStorage), null);
    setCachedWorktrees("/root", [], null);
    setCachedWorktrees("/root", [], throwingStorage);
  });
});
