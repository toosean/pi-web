import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { invalidateSessionMetadataCache, listSessionMetadata, resetSessionMetadataCacheForTesting, sessionMetadataCacheSize } =
  await jiti.import("./session-metadata.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

/**
 * The scanner replaces `SessionManager.listAll()` for the sidebar, so parity with
 * the SDK's `buildSessionInfo()` semantics is the correctness contract here. The
 * SDK accepts an explicit directory only in its flat "custom dir" mode while the
 * default mode walks project subdirectories, so the fixture is laid out the way
 * the real sessions dir is and the SDK is pointed at it with its agent-dir env.
 */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-session-meta-"));
  const sessions = join(root, "sessions");
  const projectA = join(sessions, "--home-user-project-a--");
  const projectB = join(sessions, "--home-user-project-b--");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });

  const header = (id, extra = {}) => JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/home/user/project-a",
    ...extra,
  });

  const write = (dir, name, lines, { crlf = false, trailingNewline = true } = {}) => {
    const separator = crlf ? "\r\n" : "\n";
    const body = lines.join(separator) + (trailingNewline ? separator : "");
    writeFileSync(join(dir, name), body, "utf8");
  };

  // 1. Ordinary session: user, assistant, tool result, latest name wins.
  write(projectA, "2026-01-01T00-00-00-000Z_normal.jsonl", [
    header("normal"),
    JSON.stringify({ type: "session_info", id: "n1", parentId: null, name: "  Named session  " }),
    JSON.stringify({ type: "model_change", id: "n2", parentId: null, provider: "p", modelId: "m" }),
    JSON.stringify({ type: "message", id: "n3", parentId: null, message: { role: "user", content: "hello there", timestamp: 1767225600000 } }),
    JSON.stringify({ type: "message", id: "n4", parentId: "n3", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi back" }], timestamp: 1767225660000 } }),
    JSON.stringify({ type: "message", id: "n5", parentId: "n4", message: { role: "toolResult", toolCallId: "t", content: [{ type: "text", text: "output" }] } }),
  ]);

  // 2. First flush only: no assistant message yet, and the first user message
  //    carries no text block at all.
  write(projectA, "2026-01-02T00-00-00-000Z_no_assistant.jsonl", [
    header("no-assistant"),
    JSON.stringify({ type: "message", id: "a1", parentId: null, message: { role: "user", content: [{ type: "image", source: {} }], timestamp: 1767312000000 } }),
  ]);

  // 3. Name explicitly cleared after being set, and bash-style messages that
  //    count toward messageCount without being user/assistant activity.
  write(projectA, "2026-01-03T00-00-00-000Z_cleared_name.jsonl", [
    header("cleared-name"),
    JSON.stringify({ type: "session_info", id: "c1", parentId: null, name: "temporary" }),
    JSON.stringify({ type: "session_info", id: "c2", parentId: "c1", name: "   " }),
    JSON.stringify({ type: "message", id: "c3", parentId: null, message: { role: "bashExecution", content: "ls", timestamp: 1767398400000 } }),
    JSON.stringify({ type: "message", id: "c4", parentId: "c3", message: { role: "user", content: "after bash", timestamp: 1767398460000 } }),
  ]);

  // 4. CRLF and no trailing newline.
  write(projectB, "2026-01-04T00-00-00-000Z_crlf.jsonl", [
    header("crlf", { cwd: "/home/user/project-b" }),
    JSON.stringify({ type: "message", id: "d1", parentId: null, message: { role: "user", content: "crlf body", timestamp: 1767484800000 } }),
  ], { crlf: true, trailingNewline: false });

  // 5. A malformed line in the middle must be skipped, not fatal.
  write(projectB, "2026-01-05T00-00-00-000Z_malformed.jsonl", [
    header("malformed", { cwd: "/home/user/project-b" }),
    "{ this is not json",
    JSON.stringify({ type: "message", id: "e1", parentId: null, message: { role: "user", content: "survived", timestamp: 1767571200000 } }),
    "",
  ]);

  // 6. Not a session file (no leading session header) — both sides drop it.
  write(projectB, "2026-01-06T00-00-00-000Z_not_a_session.jsonl", [
    JSON.stringify({ type: "message", id: "f1", parentId: null, message: { role: "user", content: "no header", timestamp: 1767657600000 } }),
  ]);

  // 7. A fork records its parent session path.
  write(projectB, "2026-01-07T00-00-00-000Z_fork.jsonl", [
    header("forked", { cwd: "/home/user/project-b", parentSession: join(projectA, "2026-01-01T00-00-00-000Z_normal.jsonl") }),
    JSON.stringify({ type: "message", id: "g1", parentId: null, message: { role: "user", content: "from a fork", timestamp: 1767744000000 } }),
  ]);

  // 8. Ignored noise: a non-JSONL file and a JSONL file directly in sessions/.
  writeFileSync(join(projectA, "notes.txt"), "ignore me", "utf8");
  writeFileSync(join(sessions, "2026-01-08T00-00-00-000Z_top_level.jsonl"), header("top-level") + "\n", "utf8");

  return { root, sessions };
}

function summarize(info) {
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    name: info.name ?? undefined,
    parentSessionPath: info.parentSessionPath ?? undefined,
    created: new Date(info.created).getTime(),
    modified: new Date(info.modified).getTime(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
  };
}

test("matches SessionManager.listAll() field-for-field on a fixture sessions dir", async () => {
  const { root, sessions } = createFixture();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    resetSessionMetadataCacheForTesting();
    const incremental = await listSessionMetadata(sessions);
    const reference = await SessionManager.listAll();

    const ours = incremental.map(summarize).sort((a, b) => a.id.localeCompare(b.id));
    const theirs = reference.map(summarize).sort((a, b) => a.id.localeCompare(b.id));

    assert.deepEqual(ours, theirs);
    assert.ok(ours.length >= 6, "fixture should produce several sessions");

    // Spot-check the semantics the sidebar relies on.
    const normal = ours.find((s) => s.id === "normal");
    assert.equal(normal.name, "Named session");
    assert.equal(normal.messageCount, 3);
    assert.equal(normal.firstMessage, "hello there");
    assert.equal(normal.modified, 1767225660000);

    const cleared = ours.find((s) => s.id === "cleared-name");
    assert.equal(cleared.name, undefined, "an explicit empty name clears the title");
    assert.equal(cleared.messageCount, 2);
    assert.equal(cleared.firstMessage, "after bash");

    const noAssistant = ours.find((s) => s.id === "no-assistant");
    assert.equal(noAssistant.firstMessage, "(no messages)");

    const crlf = ours.find((s) => s.id === "crlf");
    assert.equal(crlf.firstMessage, "crlf body");

    const malformed = ours.find((s) => s.id === "malformed");
    assert.equal(malformed.firstMessage, "survived");

    const forked = ours.find((s) => s.id === "forked");
    assert.ok(forked.parentSessionPath?.endsWith("2026-01-01T00-00-00-000Z_normal.jsonl"));

    assert.equal(ours.find((s) => s.id === "top-level"), undefined, "files directly in sessions/ are ignored");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    invalidateSessionMetadataCache();
  }
});

test("re-parses only the files whose identity changed", async () => {
  const { root, sessions } = createFixture();
  try {
    invalidateSessionMetadataCache();
    const first = await listSessionMetadata(sessions);
    assert.equal(sessionMetadataCacheSize(), first.length);

    // Second pass with no changes: same result, no re-parse (the cache is the
    // only thing that can produce the same object identity).
    const second = await listSessionMetadata(sessions);
    assert.equal(second.length, first.length);
    assert.ok(second.every((entry, index) => entry.path === first[index].path));

    // Appending to one file invalidates only that entry.
    const target = join(sessions, "--home-user-project-a--", "2026-01-02T00-00-00-000Z_no_assistant.jsonl");
    const appended = JSON.stringify({ type: "message", id: "a2", parentId: "a1", message: { role: "assistant", content: "now answered", timestamp: 1767312600000 } });
    writeFileSync(target, appended + "\n", { flag: "a" });

    const third = await listSessionMetadata(sessions);
    const updated = third.find((entry) => entry.id === "no-assistant");
    assert.equal(updated.messageCount, 2);
    assert.equal(updated.modified.getTime(), 1767312600000);
    // Untouched entries are served from the cache (same object reference).
    const untouchedBefore = first.find((entry) => entry.id === "normal");
    const untouchedAfter = third.find((entry) => entry.id === "normal");
    assert.equal(untouchedBefore, untouchedAfter);

    // Deleting a file drops it from the result and the cache.
    rmSync(target);
    const fourth = await listSessionMetadata(sessions);
    assert.equal(fourth.find((entry) => entry.id === "no-assistant"), undefined);
    assert.equal(sessionMetadataCacheSize(), fourth.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
    invalidateSessionMetadataCache();
  }
});

test("an unsorted modified timestamp still sorts newest first", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-meta-sort-"));
  const sessions = join(root, "sessions");
  const project = join(sessions, "--p--");
  mkdirSync(project, { recursive: true });
  const make = (id, timestamp) => JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/p" }) + "\n"
    + JSON.stringify({ type: "message", id: `${id}-m`, parentId: null, message: { role: "user", content: "x", timestamp } }) + "\n";
  writeFileSync(join(project, "old.jsonl"), make("old", 1000));
  writeFileSync(join(project, "new.jsonl"), make("new", 9000));
  writeFileSync(join(project, "mid.jsonl"), make("mid", 5000));
  try {
    invalidateSessionMetadataCache();
    const listed = await listSessionMetadata(sessions);
    assert.deepEqual(listed.map((entry) => entry.id), ["new", "mid", "old"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    invalidateSessionMetadataCache();
  }
});

test("persists versioned fingerprints and safely rebuilds corrupt or ctime-stale entries", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-meta-index-"));
  const sessions = join(root, "sessions");
  const project = join(sessions, "--project--");
  const sessionPath = join(project, "session.jsonl");
  const indexPath = join(root, "pi-web-session-index.json");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(project, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;

  const body = (text) => [
    JSON.stringify({ type: "session", version: 3, id: "persisted", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/project" }),
    JSON.stringify({ type: "message", id: "message", parentId: null, message: { role: "user", content: text, timestamp: 1767225600000 } }),
    "",
  ].join("\n");
  writeFileSync(sessionPath, body("alpha"));
  const stableTimestamp = new Date("2026-01-02T00:00:00.000Z");
  utimesSync(sessionPath, stableTimestamp, stableTimestamp);

  try {
    resetSessionMetadataCacheForTesting();
    assert.equal((await listSessionMetadata(sessions))[0].firstMessage, "alpha");
    await new Promise((resolve) => setImmediate(resolve));

    const persisted = JSON.parse(readFileSync(indexPath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal(typeof persisted.entries[sessionPath].ctimeMs, "number");
    assert.equal(statSync(indexPath).mode & 0o777, 0o600);

    resetSessionMetadataCacheForTesting();
    assert.equal(sessionMetadataCacheSize(), 1, "a restart should hydrate the persisted entry");
    assert.equal((await listSessionMetadata(sessions))[0].firstMessage, "alpha");

    writeFileSync(indexPath, "{", "utf8");
    resetSessionMetadataCacheForTesting();
    assert.equal(sessionMetadataCacheSize(), 0, "a corrupt index should be ignored");
    assert.equal((await listSessionMetadata(sessions))[0].firstMessage, "alpha");
    await new Promise((resolve) => setImmediate(resolve));

    const before = statSync(sessionPath);
    writeFileSync(sessionPath, body("bravo"));
    utimesSync(sessionPath, before.atime, before.mtime);
    assert.equal(statSync(sessionPath).size, before.size);
    assert.equal(statSync(sessionPath).mtimeMs, before.mtimeMs);

    resetSessionMetadataCacheForTesting();
    assert.equal((await listSessionMetadata(sessions))[0].firstMessage, "bravo");
  } finally {
    resetSessionMetadataCacheForTesting();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});
