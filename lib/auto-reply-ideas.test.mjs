import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { AutoReplyIdeas } = await createJiti(import.meta.url).import("./auto-reply-ideas.ts");

function harness() {
  const controller = new AutoReplyIdeas();
  const turn = { sessionId: "s", entryId: "a", leafId: "a", isCurrent: () => true };
  let resolve, calls = 0, opens = 0, allowed = true;
  const probabilities = [];
  const request = async () => { calls++; return new Promise(r => { resolve = r; }); };
  return {
    controller, turn,
    run: () => controller.consider(turn, () => allowed, probability => { opens++; probabilities.push(probability); }, request),
    release: (shouldOpen = true, probability = 0.886) => resolve(Response.json({ shouldOpen, probability })),
    probabilities,
    disallow: () => { allowed = false; },
    counts: () => ({ calls, opens }),
  };
}

test("a positive decision opens once, even after duplicate completion and closing", async () => {
  const h = harness();
  const first = h.run();
  await h.run();
  h.release(); await first;
  h.controller.suppress(h.turn);
  await h.run();
  assert.deepEqual(h.counts(), { calls: 1, opens: 1 });
  assert.deepEqual(h.probabilities, [0.886]);
});

test("manual interaction, hiding, branch changes and newer turns win over late results", async () => {
  for (const cancel of [h => h.controller.suppress(h.turn), h => h.controller.cancel(), h => h.disallow(), h => { h.turn.isCurrent = () => false; }]) {
    const h = harness();
    const pending = h.run();
    cancel(h);
    // Deliberately ignore AbortSignal, to exercise the stale-response guard.
    h.release(); await pending;
    assert.equal(h.counts().opens, 0);
  }
});

test("manual opening before completion prevents any speculative request", async () => {
  const h = harness();
  h.controller.suppress(h.turn);
  await h.run();
  assert.deepEqual(h.counts(), { calls: 0, opens: 0 });
});

test("negative and failed decisions remain silent and are not retried", async () => {
  const h = harness();
  const pending = h.run(); h.release(false); await pending;
  await h.run();
  assert.deepEqual(h.counts(), { calls: 1, opens: 0 });
  await new AutoReplyIdeas().consider(h.turn, () => true, () => assert.fail("opened"), async () => { throw new Error("offline"); });
  for (const probability of [null, "0.9", -1, 1.01]) {
    const malformed = harness();
    const pending = malformed.run();
    malformed.release(true, probability); await pending;
    assert.equal(malformed.counts().opens, 0);
  }
});
