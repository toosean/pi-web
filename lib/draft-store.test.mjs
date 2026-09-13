import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clearDraft,
  countDrafts,
  getDraft,
  mergeRestoredSubmissionDraft,
  rekeyDraft,
  restoreDraftSubmission,
  setDraft,
} = await jiti.import("./draft-store.ts");

// The store is a module-level singleton, so every test starts from a clean slate
// by clearing the keys it used.
function reset(keys) {
  for (const key of keys) clearDraft(key);
}

test("stores, clones and clears drafts", () => {
  setDraft("d1", { value: "hello", images: [{ data: "aGk=", mimeType: "image/png" }] });
  const read = getDraft("d1");
  assert.equal(read.value, "hello");
  assert.equal(read.images.length, 1);

  // Mutating a read must not affect the stored copy.
  read.value = "mutated";
  read.images[0].data = "changed";
  assert.equal(getDraft("d1").value, "hello");
  assert.equal(getDraft("d1").images[0].data, "aGk=");

  clearDraft("d1");
  assert.equal(getDraft("d1"), null);
  reset(["d1"]);
});

test("an empty draft removes the entry instead of storing it", () => {
  setDraft("d2", { value: "x", images: [] });
  assert.notEqual(getDraft("d2"), null);
  setDraft("d2", { value: "", images: [] });
  assert.equal(getDraft("d2"), null);
  reset(["d2"]);
});

test("keeps at most eight drafts, evicting the least recently written", () => {
  const keys = Array.from({ length: 12 }, (_, i) => `cap-${i}`);
  for (const key of keys) setDraft(key, { value: key, images: [] });

  assert.equal(countDrafts(), 8);
  // The four oldest writes are gone; the newest eight survive.
  for (const key of keys.slice(0, 4)) {
    assert.equal(getDraft(key), null, `${key} should have been evicted`);
  }
  for (const key of keys.slice(4)) {
    assert.equal(getDraft(key)?.value, key, `${key} should have been kept`);
  }
  reset(keys);
});

test("rewriting a draft keeps it recent, so a live composer is not evicted", () => {
  const filler = Array.from({ length: 10 }, (_, i) => `filler-${i}`);
  setDraft("live", { value: "live", images: [] });
  for (const key of filler.slice(0, 7)) setDraft(key, { value: key, images: [] });
  // The composer rewrites its draft on every keystroke, which must move it to
  // the recent end before the store has to make room again.
  setDraft("live", { value: "live again", images: [] });
  for (const key of filler.slice(7)) setDraft(key, { value: key, images: [] });

  assert.equal(getDraft("live")?.value, "live again");
  for (const key of filler.slice(0, 3)) {
    assert.equal(getDraft(key), null, `${key} should have been evicted first`);
  }
  reset(["live", ...filler]);
});

test("rekey moves a draft and keeps the newest content", () => {
  setDraft("from", { value: "old", images: [] });
  const merged = rekeyDraft("from", "to");
  assert.equal(getDraft("from"), null);
  assert.equal(getDraft("to")?.value, "old");
  assert.equal(merged.value, "old");

  // A rekey onto an existing key merges the previous content after the new one.
  setDraft("to", { value: "new", images: [] });
  setDraft("from", { value: "old", images: [] });
  const mergedBoth = rekeyDraft("from", "to");
  assert.equal(mergedBoth.value, "new\n\nold");
  assert.equal(getDraft("to")?.value, "new\n\nold");
  reset(["from", "to"]);
});

test("restoreDraftSubmission merges into whatever the composer holds", () => {
  setDraft("d3", { value: "typed", images: [] });
  const restored = restoreDraftSubmission("d3", "submitted");
  assert.equal(restored.value, "submitted\n\ntyped");
  assert.equal(getDraft("d3").value, "submitted\n\ntyped");
  reset(["d3"]);
});

test("mergeRestoredSubmissionDraft caps images and validates them", () => {
  const image = { data: "aGk=", mimeType: "image/png" };
  const merged = mergeRestoredSubmissionDraft("a", [image], "b", [image, image]);
  assert.equal(merged.value, "a\n\nb");
  assert.equal(merged.images.length, 3);

  const overLimit = mergeRestoredSubmissionDraft("", Array.from({ length: 12 }, () => image), "", []);
  assert.equal(overLimit.images.length, 10);
});
