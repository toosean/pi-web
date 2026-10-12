import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { decideReplyIdeas, replyIdeasConfig } = await jiti.import("./reply-ideas-decision.ts");
const envKeys = ["TYPESAFE_API_KEY", "PI_WEB_AUTO_REPLY_IDEAS_ENABLED", "PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD", "PI_WEB_JEV_MODEL", "PI_WEB_JEV_TIMEOUT_MS"];

function setup(t, request) {
  const old = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const info = console.info;
  const logs = [];
  console.info = (...args) => logs.push(args);
  Object.assign(process.env, { TYPESAFE_API_KEY: "test-secret", PI_WEB_AUTO_REPLY_IDEAS_ENABLED: "1", PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD: "0.7" });
  delete process.env.PI_WEB_JEV_MODEL;
  delete process.env.PI_WEB_JEV_TIMEOUT_MS;
  globalThis.__piReplyIdeasDecisions.values.clear();
  globalThis.__piReplyIdeasDecisions.pending.clear();
  globalThis.fetch = request;
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = info;
    for (const key of envKeys) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  });
  return logs;
}

const response = probability => Response.json({ answers: { should_offer_reply_ideas: { type: "noul", noul: probability } } });

test("defaults and threshold validation include both boundaries", () => {
  assert.equal(replyIdeasConfig({}).enabled, false);
  for (const value of [undefined, "", " ", "wat", "NaN", "Infinity", "-1", "1.01"]) {
    assert.equal(replyIdeasConfig({ PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD: value }).threshold, 0.7);
  }
  for (const value of ["0", "0.7", "1"]) assert.equal(replyIdeasConfig({ PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD: value }).threshold, Number(value));
});

test("Jev timeout defaults to ten seconds and accepts only positive integers up to one minute", () => {
  assert.equal(replyIdeasConfig({}).timeoutMs, 10_000);
  for (const value of [undefined, "", " ", "wat", "NaN", "Infinity", "-1", "0", "1.5", "60001"]) {
    assert.equal(replyIdeasConfig({ PI_WEB_JEV_TIMEOUT_MS: value }).timeoutMs, 10_000);
  }
  for (const value of ["1", "10000", " 15000 ", "60000"]) {
    assert.equal(replyIdeasConfig({ PI_WEB_JEV_TIMEOUT_MS: value }).timeoutMs, Number(value));
  }
});

test("strict threshold; cached probabilities use current config without another request", async t => {
  let calls = 0;
  const logs = setup(t, async (url, options) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state, { assistant_message: "private question" });
    assert.equal(body.questions.should_offer_reply_ideas.type, "noul");
    assert.equal(body.model, "jev-latest");
    return response(0.7);
  });
  assert.equal((await decideReplyIdeas("s", "a", "private question")).shouldOpen, false);
  process.env.PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD = "0.69";
  assert.equal((await decideReplyIdeas("s", "a", "private question")).shouldOpen, true);
  process.env.PI_WEB_AUTO_REPLY_IDEAS_THRESHOLD = "0.8";
  assert.equal((await decideReplyIdeas("s", "a", "private question")).shouldOpen, false);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(logs), /private question|test-secret/);
});

test("merges concurrent requests and bounds the LRU to 100 results", async t => {
  let calls = 0;
  let release;
  setup(t, async () => { calls++; await new Promise(resolve => { release = resolve; }); return response(0.9); });
  const first = decideReplyIdeas("s", "a", "question");
  const second = decideReplyIdeas("s", "a", "question");
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
  globalThis.fetch = async () => { calls++; return response(0.9); };
  for (let i = 0; i < 100; i++) await decideReplyIdeas("s", `b${i}`, "question");
  assert.equal(globalThis.__piReplyIdeasDecisions.values.size, 100);
  await decideReplyIdeas("s", "a", "question");
  assert.equal(calls, 102);
});

test("disabled and missing key do not call Jev", async t => {
  setup(t, () => { assert.fail("must not call upstream"); });
  process.env.PI_WEB_AUTO_REPLY_IDEAS_ENABLED = "0";
  assert.equal((await decideReplyIdeas("s", "a", "question")).reason, "disabled");
  process.env.PI_WEB_AUTO_REPLY_IDEAS_ENABLED = "1";
  delete process.env.TYPESAFE_API_KEY;
  assert.equal((await decideReplyIdeas("s", "a", "question")).reason, "missing_key");
});

test("upstream failures and malformed probabilities never open or retry", async t => {
  let calls = 0;
  setup(t, async () => { calls++; return new Response("secret upstream error", { status: 401 }); });
  assert.equal((await decideReplyIdeas("s", "auth", "question")).reason, "upstream_401");
  assert.equal((await decideReplyIdeas("s", "auth", "question")).shouldOpen, false);
  assert.equal(calls, 1);
  for (const [i, value] of [null, "0.9", -1, 1.2, NaN].entries()) {
    globalThis.fetch = async () => response(value);
    assert.equal((await decideReplyIdeas("s", `bad${i}`, "question")).reason, "invalid_response");
  }
  globalThis.fetch = async () => { throw new Error("Network unavailable"); };
  assert.equal((await decideReplyIdeas("s", "network", "question")).shouldOpen, false);
});

test("the default deadline allows a successful Jev response taking more than two seconds", async t => {
  let calls = 0;
  setup(t, async (_url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve(response(0.9));
      }, 2_200);
      signal.addEventListener("abort", abort, { once: true });
    });
  });
  const result = await decideReplyIdeas("s", "slow-success", "question");
  assert.equal(result.reason, "evaluated");
  assert.equal(result.shouldOpen, true);
  assert.equal(calls, 1);
});

test("aborts at the configured deadline without retry and invalidates cached failures when it changes", async t => {
  let calls = 0;
  setup(t, async (_url, { signal }) => {
    calls++;
    return new Promise((_, reject) => {
      const keepAlive = setTimeout(() => reject(new Error("timeout failed")), 3000);
      signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    });
  });
  process.env.PI_WEB_JEV_TIMEOUT_MS = "30";
  const start = Date.now();
  assert.equal((await decideReplyIdeas("s", "slow", "question")).reason, "timeout");
  assert.ok(Date.now() - start < 2000);
  assert.equal((await decideReplyIdeas("s", "slow", "question")).shouldOpen, false);
  assert.equal(calls, 1);
  process.env.PI_WEB_JEV_TIMEOUT_MS = "10000";
  globalThis.fetch = async () => { calls++; return response(0.9); };
  assert.equal((await decideReplyIdeas("s", "slow", "question")).shouldOpen, true);
  assert.equal(calls, 2);
});
