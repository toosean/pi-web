// Regression checks for the local features reconnected after the v0.12 merge.
// PI_WEB_DIST_DIR=<isolated build> node e2e/merge-regressions.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), "pi-web-merge-regressions-"));
const project = join(fixture, "project");
const sessionDir = join(fixture, "sessions", "project");
const artifacts = join(root, "test-results/e2e");
for (const path of [project, sessionDir, artifacts]) mkdirSync(path, { recursive: true });
const now = new Date().toISOString();
const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
const sessionPath = (id) => join(sessionDir, `${id}.jsonl`);
function seed(id, timestamp = now, extra = []) {
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd: project },
    { type: "message", id: `${id}-user`, parentId: null, timestamp, message: { role: "user", content: `Transcript ${id}` } },
    ...extra,
    { type: "session_info", id: `${id}-name`, parentId: extra.at(-1)?.id ?? `${id}-user`, timestamp, name: id },
  ];
  writeFileSync(sessionPath(id), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
seed("parent", now, [
  { type: "message", id: "tool", parentId: "parent-user", timestamp: now, message: {
    role: "assistant", content: [{ type: "toolCall", id: "spawn", name: "subagent", arguments: { profile: "explore", task: "Inspect" } }],
    api: "openai-completions", provider: "openai", model: "fixture", stopReason: "toolUse",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now(),
  } },
  { type: "message", id: "result", parentId: "tool", timestamp: now, message: {
    role: "toolResult", toolCallId: "spawn", toolName: "subagent", content: [{ type: "text", text: "Child completed" }], isError: false,
    details: { kind: "pi-web-subagent", sessionId: "child", profile: "explore", description: "Inspect child", status: "completed", createdAt: now, completedAt: now }, timestamp: Date.now(),
  } },
]);
seed("child", now, [{ type: "custom", id: "child-meta", parentId: "child-user", timestamp: now, customType: "pi-web:subagent", data: {
  version: 1, parentSessionId: "parent", parentSessionPath: sessionPath("parent"), profile: "explore", description: "Inspect child", task: "Inspect", createdAt: now,
} }]);
for (const id of ["pin", "unread", "recent"]) seed(id);
seed("older", old);
const otherProject = join(fixture, "other-project");
mkdirSync(otherProject);
writeFileSync(sessionPath("other-project-session"), [
  { type: "session", version: 3, id: "other-project-session", timestamp: now, cwd: otherProject },
  { type: "message", id: "other-user", parentId: null, timestamp: now, message: { role: "user", content: "Other project transcript" } },
  { type: "session_info", id: "other-name", parentId: "other-user", timestamp: now, name: "other-project-session" },
].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
writeFileSync(join(fixture, "pi-web-session-state.json"), JSON.stringify({ version: 1, revision: 1, sessions: { pin: { pinnedAt: 1 } }, projects: {}, unreadIds: ["unread"] }));
const log = createWriteStream(join(artifacts, "merge-regressions-server.log"));
let server;
let browser;
try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: fixture, PI_WEB_PASSWORD: "", PI_WEB_ALLOW_ALL_FILES: "false", PI_WEB_DISABLE_FILE_SECURITY: "false", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  const api = async (path, body) => {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  const deadline = Date.now() + 60_000;
  while (!(await fetch(`${base}/api/sessions`).catch(() => null))?.ok) {
    assert.equal(server.exitCode, null, "Server exited; see merge-regressions-server.log");
    assert.ok(Date.now() < deadline, "Server readiness timed out"); await delay(200);
  }
  browser = await chromium.launch({ channel: "chromium" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", permissions: ["clipboard-read", "clipboard-write"], hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  const childAgentRequests = [];
  const prompts = [];
  context.on("request", (request) => {
    if (/\/api\/agent\/child(?:\/|$)/.test(request.url())) childAgentRequests.push(request.url());
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(request.url()) && request.postDataJSON()?.type === "prompt") prompts.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/?session=parent`);
  const panel = page.locator("#session-sidebar-panel-sessions .sidebar-sessions-view").first();
  const row = (id) => panel.locator(`[data-row-key$=":${id}"].session-tree-session`);
  await page.getByRole("button", { name: "Switch to flat session list", exact: true }).click();
  await row("recent").waitFor();
  assert.equal(await row("older").count(), 0);
  assert.equal(await panel.locator(".session-tree-session").first().getAttribute("data-row-key"), "session:pinned:pin");
  assert.equal(await row("recent").locator(".session-tree-project").textContent(), "project");
  await panel.getByRole("button", { name: "Show 1 older sessions", exact: true }).click();
  await row("older").waitFor();
  await panel.getByRole("button", { name: "Hide older sessions", exact: true }).click();
  assert.equal(await row("older").count(), 0);
  await row("recent").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Copy file path/ }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sessionPath("recent"));
  seed("refreshed");
  await page.locator(".sidebar-header").getByRole("button", { name: "Refresh", exact: true }).click();
  await row("refreshed").waitFor();
  console.log("PASS: flat view, 24-hour filter, older window, pins first, project label, copy path, refresh");

  const other = await context.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  await other.goto(`${base}/?session=parent`);
  await other.locator('[data-row-key="session:floating:unread"]').waitFor();
  await api("/api/sessions/ui-state", { action: "set", ids: ["unread"], unread: false });
  await page.locator('[data-row-key="session:flat:unread"]').waitFor();
  await other.locator('[data-row-key="session:flat:unread"]').waitFor();
  await api("/api/sessions/ui-state", { action: "set", ids: ["recent"], unread: true });
  await page.locator('[data-row-key="session:floating:recent"]').waitFor();
  await other.locator('[data-row-key="session:floating:recent"]').waitFor();
  await other.reload();
  await other.locator('[data-row-key="session:flat:unread"]').waitFor();
  console.log("PASS: server unread revisions reconcile across two tabs and reload");
  await other.close();

  const subagent = page.getByRole("button", { name: "View sub-agent work in side panel", exact: true });
  await subagent.click();
  await page.locator("#file-panel").getByText("Transcript child", { exact: true }).waitFor();
  await subagent.click();
  assert.equal(await page.getByRole("tab", { name: /Inspect child/ }).count(), 1);
  assert.ok(page.url().includes("session=parent"));
  assert.deepEqual(childAgentRequests, []);
  await page.getByRole("button", { name: "Close Inspect child", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: /Inspect child/ }).count(), 0);
  const input = page.locator("textarea").last();
  await input.fill("/mcp");
  await input.press("Enter");
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.locator(".settings-section-tabs").getByRole("button", { name: "MCP", exact: true }).getAttribute("aria-current"), "page");
  assert.deepEqual(prompts, []);
  await page.keyboard.press("Escape");
  console.log("PASS: subagent panel is read-only and deduplicated; bare /mcp opens MCP settings");

  const box = await row("refreshed").boundingBox();
  const cdp = await context.newCDPSession(page);
  const x = box.x + box.width * 0.65, y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const dx of [15, 35, 55, 85]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - dx, y }] }); await delay(40);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await row("refreshed").waitFor({ state: "hidden" });
  const touchUndo = page.waitForResponse((response) => response.url().endsWith("/api/sessions/ui-state")
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.action === "restore");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await touchUndo;
  await row("refreshed").waitFor();
  assert.ok(page.url().includes("session=parent"), "A swipe must not select the row");
  console.log("PASS: touch swipe archives and Undo restores without selecting the row");

  const mouseDrag = async (id, dx, dy = 0, options = {}) => {
    const target = row(id).locator(".session-tree-main");
    const rect = await target.boundingBox();
    const start = { x: rect.x + 35, y: rect.y + rect.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down(options);
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    await page.mouse.up(options);
  };
  // Start on the saved row's actual link: its native HTML drag must not take
  // the pointer away, and releasing a drag must not activate the session.
  await mouseDrag("refreshed", 90);
  await row("refreshed").waitFor({ state: "hidden" });
  assert.ok(page.url().includes("session=parent"));
  const mouseUndo = page.waitForResponse((response) => response.url().endsWith("/api/sessions/ui-state")
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.action === "restore");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await mouseUndo;
  await row("refreshed").waitFor();
  const dragState = (await api("/api/sessions/ui-state")).state;
  assert.equal(dragState.sessions.refreshed?.archivedAt, undefined);
  // Short drags and vertical moves leave the session alone and do not select it.
  await mouseDrag("refreshed", 30);
  await row("refreshed").waitFor();
  assert.ok(page.url().includes("session=parent"));
  await mouseDrag("refreshed", 3, 35);
  await row("refreshed").waitFor();
  assert.ok(page.url().includes("session=parent"));
  // Cancelling a captured pointer must reset the row without archiving it.
  const dragRect = await row("refreshed").locator(".session-tree-main").boundingBox();
  await page.mouse.move(dragRect.x + 35, dragRect.y + dragRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragRect.x + 125, dragRect.y + dragRect.height / 2, { steps: 12 });
  await row("refreshed").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  await row("refreshed").waitFor();
  assert.equal(await row("refreshed").evaluate((element) => element.style.transform), "");
  assert.ok(page.url().includes("session=parent"));
  // Middle and modifier clicks keep opening the saved session link in a tab.
  for (const options of [{ button: "middle" }, { modifiers: ["Control"] }]) {
    const opened = context.waitForEvent("page");
    await row("refreshed").locator(".session-tree-main").click(options);
    const popup = await opened;
    await popup.waitForURL((url) => url.searchParams.get("session") === "refreshed");
    await popup.close();
    assert.ok(page.url().includes("session=parent"));
  }
  await row("refreshed").locator(".session-tree-main").click();
  await page.getByText("Transcript refreshed", { exact: true }).waitFor();
  await row("parent").locator(".session-tree-main").click();
  await page.getByText("Transcript parent", { exact: true }).waitFor();
  console.log("PASS: mouse right-drag archives from a link, Undo restores, short/vertical/cancelled drags are safe, and ordinary clicks still select");
  await subagent.click();
  await page.locator("#file-panel").getByText("Transcript child", { exact: true }).waitFor();
  await row("other-project-session").locator(".session-tree-main").click();
  await page.getByText("Other project transcript", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: /Inspect child/ }).count(), 0);
  console.log("PASS: switching projects closes transient subagent viewer tabs");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(artifacts, "merge-regressions.png") });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(`${base}/?session=parent`);
  const hideSidebar = mobile.getByRole("button", { name: "Hide sidebar", exact: true });
  if (await hideSidebar.isVisible()) await hideSidebar.click();
  await mobile.getByRole("button", { name: "View sub-agent work in side panel", exact: true }).click();
  await mobile.locator("#file-panel").getByText("Transcript child", { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Close Inspect child", exact: true }).click();
  await mobile.locator("#file-panel").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("PASS: the mobile subagent panel opens and closes");
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  log.end();
  rmSync(fixture, { recursive: true, force: true });
}
