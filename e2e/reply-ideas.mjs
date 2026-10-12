// Run against an isolated dev checkout: PI_WEB_E2E_URL=http://127.0.0.1:30251 node e2e/reply-ideas.mjs
// All session/provider APIs are fixtures: this never prompts or mutates a real session.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PI_WEB_E2E_URL || "http://127.0.0.1:30251";
const locale = process.env.PI_WEB_E2E_LOCALE || "en";
const labels = {
  en: { panel: "Suggested replies", send: "Send", close: "Close", reply: "Reply ideas", refresh: "Generate new replies", retry: "Retry", badge: "Opened by Jev · 89%", hint: "Jev’s predicted probability that you would click Reply ideas." },
  "zh-CN": { panel: "建议回复", send: "发送", close: "关闭", reply: "建议回复", refresh: "重新生成回复", retry: "重试", badge: "Jev 自动展开 · 89%", hint: "Jev 预测你会点击“建议回复”的概率。" },
  "zh-TW": { panel: "建議回覆", send: "傳送", close: "關閉", reply: "建議回覆", refresh: "重新產生回覆", retry: "重試", badge: "Jev 自動展開 · 89%", hint: "Jev 預測你會點擊「建議回覆」的機率。" },
}[locale];
assert.ok(labels, "unsupported fixture locale");
const width = Number(process.env.PI_WEB_E2E_WIDTH || 1280);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let id = "jev-browser-fixture";
const timestamp = new Date().toISOString();
const session = { id, path: "/tmp/jev-fixture.jsonl", cwd: "/tmp", projectRoot: "/tmp", created: timestamp, modified: timestamp, messageCount: 2, firstMessage: "Fixture", name: "Jev browser fixture" };
let running = false, sequence = 0, decisions = 0, generations = 0, prompts = 0;
let shouldOpen = true, delayedDecision = null, holdDecision = false;
let holdGeneration = false, delayedGeneration = null, failGeneration = false;
const messages = [{ role: "user", content: "Old question" }, { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Old completed answer" }] }];
const entryIds = ["u0", "a0"];
const model = { provider: "fixture", id: "fixture", name: "Fixture" };
const state = () => ({ running: true, state: { isStreaming: running, isPromptRunning: running, isCompacting: false, model, queuedMessages: { steering: [], followUp: [] } } });
const detail = () => ({ sessionId: id, filePath: session.path, totalActiveMs: 0, tree: [], leafId: entryIds.at(-1), context: { messages, entryIds, oldestEntryId: entryIds[0], hasMore: false, thinkingLevel: "off", model: { provider: "fixture", modelId: "fixture" } } });
const emit = event => page.evaluate(({ id, event }) => {
  for (const source of window.__jevSources) {
    if (source.url.includes(`/agent/${id}/`) && source.readyState === 1) source.onmessage?.({ data: JSON.stringify(event) });
  }
}, { id, event });
const eventually = async check => {
  const until = Date.now() + 30_000;
  while (!check()) {
    if (Date.now() > until) throw new Error("Fixture condition timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

await page.addInitScript(locale => {
  localStorage.setItem("pi-sound-enabled", "false");
  localStorage.setItem("pi-locale", locale);
  window.__jevSources = [];
  window.EventSource = class {
    static OPEN = 1;
    static CLOSED = 2;
    readyState = 1;
    constructor(url) {
      this.url = url;
      window.__jevSources.push(this);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }), 0);
    }
    close() { this.readyState = 2; }
  };
}, locale);

await page.route("**/api/**", async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const json = body => route.fulfill({ json: body });
  if (path.endsWith("/suggested-replies/decision")) {
    decisions++;
    const result = { probability: shouldOpen ? 0.886 : 0.2, threshold: 0.7, shouldOpen, reason: "evaluated" };
    if (holdDecision) {
      delayedDecision = () => json(result).catch(() => {});
      return;
    }
    return json(result);
  }
  if (path.endsWith("/suggested-replies")) {
    generations++;
    if (failGeneration) return route.fulfill({ status: 503, json: { error: "Fixture generation failure" } });
    if (holdGeneration) {
      delayedGeneration = () => json({ suggestions: ["Choose A", "Choose B"], usage: null });
      return;
    }
    return json({ suggestions: ["Choose A", "Choose B"], usage: null });
  }
  if (path === "/api/sessions") return json({ sessions: [session], sessionListVersion: 1, runningSessionIds: running ? [id] : [] });
  if (path === "/api/cwd/validate") return json({ success: true, cwd: "/tmp", projectRoot: "/tmp", projectKey: "/tmp" });
  if (path === "/api/agent/new") return json({ sessionId: id, model: { provider: "fixture", modelId: "fixture" }, thinkingLevel: "off" });
  if (path === `/api/sessions/${id}`) return json(detail());
  if (path === `/api/sessions/${id}/state`) return json(state());
  if (path === "/api/agent/running") return json({ runningSessionIds: running ? [id] : [], sessionListVersion: 1 });
  if (path === `/api/agent/${id}`) {
    if (request.method() === "GET") return json(state());
    const command = request.postDataJSON();
    if (command.type === "prompt") {
      running = true; prompts++; sequence++;
      messages.push({ role: "user", content: command.message }); entryIds.push(`u${sequence}`);
      await emit({ type: "agent_start" });
    }
    return json({ success: true, data: command.type === "get_tools" ? [] : {} });
  }
  if (path === "/api/models") return json({ models: { "fixture/fixture": "Fixture" }, modelList: [model], defaultModel: { provider: "fixture", modelId: "fixture" } });
  if (path === "/api/home") return json({ home: "/tmp" });
  if (path === "/api/app-update") return json({ currentVersion: "0.9.1", latestVersion: "0.9.1", updateAvailable: false, releaseUrl: "" });
  if (path === "/api/worktrees") return json({ worktrees: [], isGitRepo: false });
  return json({});
});

const input = () => page.locator("textarea:visible").last();
const panel = () => page.getByRole("region", { name: labels.panel });
const badge = () => panel().getByText(labels.badge, { exact: true });
const start = async () => {
  const count = prompts;
  await input().fill(`Test prompt ${sequence + 1}`);
  await page.getByRole("button", { name: labels.send, exact: true }).click();
  await eventually(() => prompts === count + 1);
};
const finish = async ({ stopReason = "stop", reconcile = false } = {}) => {
  messages.push({ role: "assistant", stopReason, content: [{ type: "text", text: `Answer ${sequence}: Choose A or B?` }] });
  entryIds.push(`a${sequence}`); running = false;
  if (reconcile) {
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  } else {
    await emit({ type: "agent_end" });
    await emit({ type: "agent_settled" });
    await emit({ type: "prompt_done" });
  }
  await page.getByText(`Answer ${sequence}: Choose A or B?`, { exact: true }).waitFor();
  await page.getByRole("button", { name: labels.send, exact: true }).waitFor();
};

try {
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Old completed answer", { exact: true }).waitFor();
  assert.equal(decisions, 0, "opening historical session must not evaluate");

  await start();
  await emit({ type: "agent_end", willRetry: true });
  await emit({ type: "agent_start" });
  assert.equal(decisions, 0, "intermediate end must not evaluate");
  holdGeneration = true;
  await finish();
  await eventually(() => delayedGeneration !== null);
  await badge().waitFor();
  assert.equal(await badge().getAttribute("title"), labels.hint);
  assert.equal(await panel().getAttribute("aria-busy"), "true");
  await delayedGeneration(); delayedGeneration = null; holdGeneration = false;
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  await badge().waitFor();
  assert.equal(decisions, 1); assert.equal(generations, 1);
  assert.equal(await input().inputValue(), "", "auto opening must not fill or send the composer");
  await emit({ type: "agent_settled" }); await emit({ type: "prompt_done" });
  await panel().getByRole("button", { name: labels.close, exact: true }).click();
  assert.equal(decisions, 1); assert.equal(generations, 1);
  console.log("PASS: history, intermediate events, auto-open, duplicate completion, close and untouched composer");

  await page.getByRole("button", { name: labels.reply, exact: true }).last().hover({ force: true });
  await page.getByRole("button", { name: labels.reply, exact: true }).last().click();
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  assert.equal(await badge().count(), 0, "manual reopening must clear Jev attribution even with cached replies");
  assert.equal(generations, 1);
  await panel().getByRole("button", { name: labels.close, exact: true }).click();
  console.log("PASS: cached manual reopening clears Jev attribution");

  shouldOpen = false;
  await start(); await finish();
  await eventually(() => decisions === 2);
  assert.equal(await panel().count(), 0);
  await page.getByRole("button", { name: labels.reply, exact: true }).last().hover({ force: true });
  await page.getByRole("button", { name: labels.reply, exact: true }).last().click();
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  assert.equal(generations, 2);
  assert.equal(await badge().count(), 0);
  await panel().getByRole("button", { name: labels.close, exact: true }).click();
  console.log("PASS: negative decision keeps manual generation available");

  shouldOpen = true; holdDecision = true;
  await start(); await finish();
  await eventually(() => delayedDecision !== null);
  await page.getByRole("button", { name: labels.reply, exact: true }).last().hover({ force: true });
  await page.getByRole("button", { name: labels.reply, exact: true }).last().click();
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  assert.equal(await badge().count(), 0);
  await panel().getByRole("button", { name: labels.close, exact: true }).click();
  await delayedDecision(); delayedDecision = null;
  assert.equal(generations, 3); assert.equal(await panel().count(), 0);
  console.log("PASS: manual open and close wins against a delayed Jev result");

  await start(); await finish();
  await eventually(() => delayedDecision !== null);
  const stale = delayedDecision; delayedDecision = null;
  await start(); await stale();
  assert.equal(await panel().count(), 0);
  holdDecision = false;
  await finish({ stopReason: "aborted" });
  assert.equal(decisions, 4); assert.equal(generations, 3);
  console.log("PASS: next run invalidates old decision; aborted turn is skipped");

  await start(); await finish({ reconcile: true });
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  assert.equal(decisions, 5); assert.equal(generations, 4);
  console.log("PASS: missed terminal SSE recovers through state reconciliation");

  await mkdir("test-results/reply-ideas", { recursive: true });
  await page.screenshot({ path: `test-results/reply-ideas/auto-open-${locale}-${width}.png` });

  await start();
  const previousDecisions = decisions;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await finish();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: labels.reply, exact: true }).last().waitFor();
  assert.equal(decisions, previousDecisions);
  assert.equal(await panel().count(), 0);
  console.log("PASS: hidden-page completion is not replayed on return");

  id = "jev-browser-fresh";
  Object.assign(session, { id, path: "/tmp/jev-fresh.jsonl", messageCount: 0 });
  messages.length = 0; entryIds.length = 0; sequence = 0;
  await page.goto(`${base}/?cwd=/tmp`, { waitUntil: "domcontentloaded" });
  await input().waitFor();
  await start(); await finish();
  await panel().getByRole("button", { name: "Choose A", exact: true }).waitFor();
  assert.equal(decisions, previousDecisions + 1);
  assert.equal(generations, 5);
  console.log("PASS: first completed turn survives fresh-session promotion");

  failGeneration = true;
  await panel().getByRole("button", { name: labels.refresh, exact: true }).click();
  await panel().getByRole("alert").waitFor();
  await badge().waitFor();
  failGeneration = false;
  await panel().getByRole("button", { name: labels.retry, exact: true }).click();
  await eventually(() => generations === 7);
  await page.waitForFunction(() => document.querySelector('[role="region"][id="suggested-replies-panel"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await panel().getByRole("alert").count(), 0);
  await badge().waitFor();
  const layout = await panel().evaluate(element => ({ overflow: element.scrollWidth > element.clientWidth, right: element.getBoundingClientRect().right, viewport: innerWidth }));
  assert.equal(layout.overflow, false);
  assert.ok(layout.right <= layout.viewport + 1);
  await panel().screenshot({ path: `test-results/reply-ideas/jev-hint-${locale}-${width}.png` });
  console.log(`PASS: ${locale} Jev attribution, rounding, tooltip, loading, retry and ${width}px layout`);
  assert.deepEqual(errors, []);
} catch (error) {
  await mkdir("test-results/reply-ideas", { recursive: true });
  await page.screenshot({ path: `test-results/reply-ideas/failure-${locale}-${width}.png` });
  console.error({ decisions, generations, prompts, errors });
  throw error;
} finally {
  await browser.close();
}
