// PI_WEB_DIST_DIR=<isolated build> node e2e/attachment-regressions.mjs
// Real upload/session APIs; simulated agent events and phone audio restriction.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), "pi-web-attachment-regressions-"));
const agentDir = join(fixture, "agent");
const project = join(fixture, "project"), uploads = join(fixture, "uploads"), sessions = join(agentDir, "sessions", "project");
const artifacts = join(root, "test-results/e2e");
for (const dir of [project, uploads, sessions, artifacts]) mkdirSync(dir, { recursive: true });
const timestamp = new Date().toISOString();
const sessionPath = (id) => join(sessions, `${id}.jsonl`);
for (const id of ["parent", "recent", "hidden", "rewrite"]) {
  writeFileSync(sessionPath(id), [
    { type: "session", version: 3, id, timestamp, cwd: project },
    { type: "message", id: `${id}-user`, parentId: null, timestamp, message: { role: "user", content: `Transcript ${id}` } },
    { type: "session_info", id: `${id}-name`, parentId: `${id}-user`, timestamp, name: id },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
utimesSync(sessionPath("rewrite"), 1780000000, 1780000000);
writeFileSync(join(project, "same.txt"), "OLD PROJECT CONTENT");
const log = createWriteStream(join(artifacts, "attachment-regressions-server.log"));
let server, browser;
try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, env: { ...process.env, TMPDIR: uploads, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", PI_WEB_ALLOW_ALL_FILES: "false", PI_WEB_DISABLE_FILE_SECURITY: "false", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  const api = async (path, body) => {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  const deadline = Date.now() + 60_000;
  while (!(await fetch(`${base}/api/sessions`).catch(() => null))?.ok) {
    assert.equal(server.exitCode, null, "Server exited; see attachment-regressions-server.log");
    assert.ok(Date.now() < deadline, "Server readiness timed out"); await delay(200);
  }
  const first = await api("/api/sessions/rewrite?tree=summary");
  const before = statSync(sessionPath("rewrite"));
  await delay(20);
  writeFileSync(sessionPath("rewrite"), readFileSync(sessionPath("rewrite"), "utf8").replace("Transcript rewrite", "Changed___ rewrite"));
  utimesSync(sessionPath("rewrite"), before.atime, before.mtime);
  const after = statSync(sessionPath("rewrite"));
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.notEqual(after.ctimeMs, before.ctimeMs);
  const changed = await api("/api/sessions/rewrite?tree=summary&force=1");
  assert.equal(changed.context.messages[0].content, "Changed___ rewrite");
  assert.notEqual(changed.snapshotRevision, first.snapshotRevision);
  console.log("PASS: same-size rewrite with restored mtime returns the new body");

  browser = await chromium.launch({ channel: "chromium" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await context.addInitScript(() => {
    // Reintroduce stale keys on reload too: the receipt must prevent resurrection.
    localStorage.setItem("pi-web:pinned-session-ids", JSON.stringify(["recent"]));
    localStorage.setItem("pi-web:hidden-session-ids", JSON.stringify(["hidden"]));
    localStorage.setItem("pi-sound-enabled", "true");
    const NativeEventSource = window.EventSource;
    window.__auditStreams = [];
    window.EventSource = class {
      constructor(url) {
        if (!/\/api\/agent\/parent\/events/.test(url)) return new NativeEventSource(url);
        this.url = url; this.readyState = 1; window.__auditStreams.push(this);
        setTimeout(() => this.emit({ type: "connected", pendingExtensionUiIds: [] }), 10);
      }
      emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
      close() { this.readyState = 2; }
    };
    window.__auditAudio = [];
    const node = () => ({ connect() {}, start() {}, stop() {}, frequency: {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    window.AudioContext = class {
      constructor() { this.state = "suspended"; this.currentTime = 0; this.destination = {}; this.tones = 0; window.__auditAudio.push(this); }
      resume() {
        if (window.__auditLocked && this.state === "suspended") return new Promise(() => {});
        this.state = "running"; return Promise.resolve();
      }
      suspend() { this.state = "suspended"; return Promise.resolve(); }
      createOscillator() { this.tones++; return node(); }
      createGain() { return node(); }
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  const errors = [], commands = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let running = false;
  await context.route("**/api/agent/parent", async (route) => {
    const request = route.request();
    let data = { running, state: { isStreaming: running, isPromptRunning: running, thinkingLevel: "off", toolNames: ["read"] } };
    if (request.method() === "POST") {
      const command = request.postDataJSON(); commands.push(command);
      if (command.type === "prompt") running = true;
      data = { success: true, data: command.type === "get_tools" ? { tools: [] } : command.type === "get_commands" ? { commands: [] } : {} };
    }
    await route.fulfill({ json: data });
  });
  await page.goto(`${base}/?session=parent`);
  const active = page.locator('[data-session-id="parent"]'), input = active.locator("textarea");
  await input.waitFor();
  await page.waitForFunction(() => localStorage.getItem("pi-web:session-flags-migrated") === "1");
  const migrated = (await api("/api/sessions/ui-state")).state;
  assert.ok(migrated.sessions.recent.pinnedAt >= 0); assert.ok(migrated.sessions.hidden.archivedAt >= 0);
  await api("/api/sessions/ui-state", { action: "set", ids: ["recent"], pinned: false });
  await api("/api/sessions/ui-state", { action: "set", ids: ["hidden"], archived: false });
  await page.reload(); await input.waitFor(); await delay(300);
  const reloaded = (await api("/api/sessions/ui-state")).state;
  assert.equal(reloaded.sessions.recent, undefined); assert.equal(reloaded.sessions.hidden, undefined);
  console.log("PASS: browser pins/hides migrate once and respect later server changes");

  let releaseUpload, startedUpload;
  const gate = new Promise((resolve) => { releaseUpload = resolve; });
  const started = new Promise((resolve) => { startedUpload = resolve; });
  await page.route("**/api/upload", async (route) => {
    if (!route.request().postData()?.includes('filename="slow.txt"')) return route.continue();
    startedUpload(); await gate;
    await route.fulfill({ response: await route.fetch() });
  });
  const pick = (name, text) => active.locator('input[type="file"]').last().setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await input.fill("check uploaded document");
  await pick("slow.txt", "SLOW USER CONTENT"); await started;
  await active.getByText(/Uploading slow\.txt/).waitFor();
  assert.equal(await active.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  await input.press("Enter");
  assert.equal(commands.filter((command) => command.type === "prompt").length, 0);
  await page.locator('[data-row-key$=":recent"] .session-tree-main').first().click();
  await page.locator('[data-session-id="recent"] textarea').waitFor();
  await page.locator('[data-row-key$=":parent"] .session-tree-main').first().click();
  assert.equal(await input.inputValue(), "check uploaded document");
  await active.getByRole("button", { name: "Cancel upload", exact: true }).waitFor();
  releaseUpload(); await active.getByRole("button", { name: "Remove file", exact: true }).waitFor();
  await active.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => window.__auditStreams.length > 0);
  await delay(200);
  const prompt = commands.find((command) => command.type === "prompt");
  assert.ok(prompt.message.includes(join(uploads, "slow.txt")));
  assert.equal(readFileSync(join(uploads, "slow.txt"), "utf8"), "SLOW USER CONTENT");
  console.log("PASS: tracked upload blocks early sending and survives session switches; the prompt carries the uploaded path");

  // A hidden, resident running window must retain its audio hold as well.
  await page.locator('[data-row-key$=":recent"] .session-tree-main').first().click();
  await delay(1300);
  assert.equal(await page.evaluate(() => window.__auditAudio.at(-1).state), "running");
  await page.locator('[data-row-key$=":parent"] .session-tree-main').first().click();
  running = false;
  await page.evaluate(() => {
    window.__auditLocked = true;
    const stream = window.__auditStreams.at(-1);
    stream.emit({ type: "agent_end" });
    stream.emit({ type: "agent_settled", aborted: false });
    stream.emit({ type: "prompt_done", aborted: false });
  });
  await page.waitForFunction(() => window.__auditAudio.at(-1).tones === 2);
  await delay(1300);
  assert.equal(await page.evaluate(() => window.__auditAudio.at(-1).state), "suspended");
  await page.evaluate(() => { window.__auditLocked = false; });
  console.log("PASS: audio stays running during the task, plays with simulated phone lock, and suspends after completion");

  const saveSameName = async (text) => {
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/upload" && response.ok());
    await pick("same.txt", text);
    return (await response).json();
  };
  const same = [await saveSameName("NEW USER CONTENT")];
  await active.getByRole("button", { name: "Remove file", exact: true }).waitFor();
  same.push(await saveSameName("SECOND USER CONTENT"));
  await page.waitForFunction(() => document.querySelectorAll('[title="Remove file"]').length === 2);
  assert.equal(same.length, 2); assert.notEqual(same[0].filePath, same[1].filePath);
  assert.equal(readFileSync(same[0].filePath, "utf8"), "NEW USER CONTENT");
  assert.equal(readFileSync(same[1].filePath, "utf8"), "SECOND USER CONTENT");
  assert.equal(readFileSync(join(project, "same.txt"), "utf8"), "OLD PROJECT CONTENT");
  await active.getByRole("button", { name: "Send", exact: true }).click();
  await delay(200);
  const secondPrompt = commands.filter((command) => command.type === "prompt")[1];
  assert.ok(same.every((file) => secondPrompt.message.includes(file.filePath)));
  console.log("PASS: same-named attachments retain their own content and never substitute the existing project file");

  let releaseCancelled, cancelledStarted;
  const cancelledGate = new Promise((resolve) => { releaseCancelled = resolve; });
  const cancelledRequest = new Promise((resolve) => { cancelledStarted = resolve; });
  await page.route("**/api/upload", async (route) => {
    if (!route.request().postData()?.includes('filename="cancel.txt"')) return route.fallback();
    cancelledStarted(); await cancelledGate;
    await route.fulfill({ json: { success: true, filePath: join(uploads, "cancel.txt") } }).catch(() => {});
  });
  await input.fill("after cancellation"); await pick("cancel.txt", "cancel"); await cancelledRequest;
  assert.equal(await active.getByRole("button", { name: "Steer", exact: true }).isDisabled(), true);
  assert.equal(await active.getByRole("button", { name: "Follow-up", exact: true }).isDisabled(), true);
  await active.getByRole("button", { name: "Cancel upload", exact: true }).click();
  releaseCancelled(); await delay(200);
  assert.equal(await active.getByRole("button", { name: "Steer", exact: true }).isEnabled(), true);
  assert.equal(await active.getByRole("button", { name: "Follow-up", exact: true }).isEnabled(), true);
  assert.equal(await active.locator('[title="cancel.txt"]').count(), 0);
  assert.equal(await input.inputValue(), "after cancellation");
  running = false;
  await page.evaluate(() => {
    const stream = window.__auditStreams.at(-1);
    stream.emit({ type: "agent_end" });
    stream.emit({ type: "agent_settled", aborted: false });
    stream.emit({ type: "prompt_done", aborted: false });
  });
  await active.getByRole("button", { name: "Send", exact: true }).waitFor();
  console.log("PASS: uploads also gate steer/follow-up; cancellation removes them without a late response changing the draft");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(artifacts, "attachment-regressions.png") });
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, "exit"); server.kill("SIGTERM");
    const force = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await exited; clearTimeout(force);
  }
  log.end(); rmSync(fixture, { recursive: true, force: true });
}
