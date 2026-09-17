import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applySessionPreferences,
  clearSessionFlags,
  getSessionFlags,
  getSessionPreferencesPath,
  invalidateSessionPreferencesCache,
  mergeSessionFlags,
  parseSessionFlagIdLists,
  parseSessionFlagPatch,
  readSessionFlags,
  writeSessionFlagPatch,
} = await jiti.import("./session-preferences.ts");

function tempAgentDir(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-session-prefs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // getPiWebDataDir joins `<agentDir>/../pi-web`, so the readable state file
  // lives next to the fake agent dir exactly as it does in `~/.pi-web`.
  return join(root, "agent");
}

function storedFile(agentDir) {
  return getSessionPreferencesPath(agentDir);
}

function writeStoredFile(agentDir, contents) {
  const path = storedFile(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

test("missing state file reads as no flags", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  assert.equal(readSessionFlags(agentDir).size, 0);
  assert.deepEqual(getSessionFlags("s1", agentDir), {});
});

test("writes and clears flags for one session", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();

  assert.deepEqual(writeSessionFlagPatch("s1", { pinned: true }, agentDir), { pinned: true });
  assert.deepEqual(writeSessionFlagPatch("s1", { hidden: true, unread: true }, agentDir), {
    pinned: true,
    hidden: true,
    unread: true,
  });
  assert.deepEqual(getSessionFlags("s1", agentDir), { pinned: true, hidden: true, unread: true });

  assert.deepEqual(writeSessionFlagPatch("s1", { pinned: false, unread: false }, agentDir), { hidden: true });
  assert.deepEqual(getSessionFlags("s1", agentDir), { hidden: true });

  // The last flag removed drops the entry entirely rather than storing `{}`.
  writeSessionFlagPatch("s1", { hidden: false }, agentDir);
  assert.equal(readSessionFlags(agentDir).size, 0);
  const stored = JSON.parse(readFileSync(storedFile(agentDir), "utf8"));
  assert.deepEqual(stored, { version: 1, sessions: {} });
});

test("keeps flags of other sessions when one is written", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  writeSessionFlagPatch("s1", { pinned: true }, agentDir);
  writeSessionFlagPatch("s2", { hidden: true }, agentDir);
  assert.deepEqual(getSessionFlags("s1", agentDir), { pinned: true });
  assert.deepEqual(getSessionFlags("s2", agentDir), { hidden: true });
});

test("a corrupt or unreadable state file degrades to no flags", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  writeSessionFlagPatch("s1", { pinned: true }, agentDir);

  writeStoredFile(agentDir, "{ not json");
  invalidateSessionPreferencesCache();
  assert.equal(readSessionFlags(agentDir).size, 0);

  // A corrupt file must not break the next write either.
  assert.deepEqual(writeSessionFlagPatch("s1", { pinned: true }, agentDir), { pinned: true });
  assert.deepEqual(getSessionFlags("s1", agentDir), { pinned: true });
});

test("ignores unknown versions, unknown flags and non-boolean values", (t) => {
  const agentDir = tempAgentDir(t);
  writeStoredFile(agentDir, JSON.stringify({
    version: 99,
    sessions: { s1: { pinned: true } },
  }));
  invalidateSessionPreferencesCache();
  assert.equal(readSessionFlags(agentDir).size, 0);

  writeStoredFile(agentDir, JSON.stringify({
    version: 1,
    sessions: {
      s1: { pinned: "yes", hidden: true, somethingElse: true },
      s2: { nothing: true },
      s3: null,
    },
  }));
  invalidateSessionPreferencesCache();
  const flags = readSessionFlags(agentDir);
  assert.deepEqual([...flags.keys()], ["s1"]);
  assert.deepEqual(flags.get("s1"), { hidden: true });
});

test("picks up a state file rewritten outside pi-web", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  writeSessionFlagPatch("s1", { pinned: true }, agentDir);
  assert.deepEqual([...readSessionFlags(agentDir).keys()], ["s1"]);

  writeStoredFile(agentDir, JSON.stringify({
    version: 1,
    sessions: { external: { pinned: true } },
  }));
  assert.deepEqual([...readSessionFlags(agentDir).keys()], ["external"]);
});

test("clearSessionFlags only reports and writes real removals", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  writeSessionFlagPatch("s1", { pinned: true }, agentDir);
  writeSessionFlagPatch("s2", { hidden: true }, agentDir);

  assert.equal(clearSessionFlags(["missing"], agentDir), 0);
  assert.equal(clearSessionFlags(["s1", "missing"], agentDir), 1);
  assert.deepEqual([...readSessionFlags(agentDir).keys()], ["s2"]);
});

test("mergeSessionFlags is a union that skips unresolvable ids", (t) => {
  const agentDir = tempAgentDir(t);
  invalidateSessionPreferencesCache();
  writeSessionFlagPatch("existing", { hidden: true }, agentDir);

  const { applied, skipped } = mergeSessionFlags(
    { pinned: ["existing", "fresh", "deleted"], unread: ["fresh"] },
    new Set(["existing", "fresh"]),
    agentDir,
  );

  assert.deepEqual({ applied, skipped }, { applied: 3, skipped: 1 });
  // The union never clears what the server already had.
  assert.deepEqual(getSessionFlags("existing", agentDir), { hidden: true, pinned: true });
  assert.deepEqual(getSessionFlags("fresh", agentDir), { pinned: true, unread: true });
  assert.deepEqual(getSessionFlags("deleted", agentDir), {});

  // Replaying the same payload changes nothing.
  const replay = mergeSessionFlags(
    { pinned: ["existing", "fresh"], unread: ["fresh"] },
    new Set(["existing", "fresh"]),
    agentDir,
  );
  assert.deepEqual(replay, { applied: 0, skipped: 0 });
});

test("applySessionPreferences attaches only stored flags", () => {
  const sessions = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ];
  const flags = new Map([
    ["a", { pinned: true, hidden: true }],
    ["c", { unread: true }],
  ]);
  assert.deepEqual(applySessionPreferences(sessions, flags), [
    { id: "a", pinned: true, hidden: true },
    { id: "b" },
    { id: "c", unread: true },
  ]);
  // With nothing stored the identities are preserved.
  assert.equal(applySessionPreferences(sessions, new Map())[0], sessions[0]);
});

test("request bodies are validated", () => {
  assert.deepEqual(parseSessionFlagPatch({ pinned: true }), { pinned: true });
  assert.deepEqual(parseSessionFlagPatch({ pinned: false, unread: true }), { pinned: false, unread: true });
  assert.equal(parseSessionFlagPatch({}), null);
  assert.equal(parseSessionFlagPatch({ pinned: "true" }), null);
  assert.equal(parseSessionFlagPatch(null), null);
  assert.equal(parseSessionFlagPatch([1]), null);

  assert.deepEqual(parseSessionFlagIdLists({ pinned: ["a"], ignored: 1 }), { pinned: ["a"] });
  assert.deepEqual(parseSessionFlagIdLists({ hidden: [] }), { hidden: [] });
  assert.equal(parseSessionFlagIdLists({}), null);
  assert.equal(parseSessionFlagIdLists({ pinned: [1] }), null);
  assert.equal(parseSessionFlagIdLists({ pinned: "a" }), null);
  assert.equal(parseSessionFlagIdLists({ pinned: new Array(5001).fill("a") }), null);
});
