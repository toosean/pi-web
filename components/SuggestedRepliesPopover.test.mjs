import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  joinSelectedSuggestedReplies,
  toggleSuggestedReplySelection,
} = await jiti.import("./SuggestedRepliesPopover.tsx");

test("toggles suggested reply phrases without mutating the previous selection", () => {
  const original = new Set(["运行测试"]);
  const added = toggleSuggestedReplySelection(original, "发布到 PM2");
  const removed = toggleSuggestedReplySelection(added, "运行测试");

  assert.deepEqual([...original], ["运行测试"]);
  assert.deepEqual([...added], ["运行测试", "发布到 PM2"]);
  assert.deepEqual([...removed], ["发布到 PM2"]);
});

test("joins selected phrases in display order with semicolons", () => {
  const suggestions = ["查看改动", "运行测试", "提交代码", "发布到 PM2"];
  const selected = new Set(["发布到 PM2", "运行测试", "查看改动"]);

  assert.equal(
    joinSelectedSuggestedReplies(suggestions, selected),
    "查看改动; 运行测试; 发布到 PM2",
  );
});

test("renders all phrases as a wrapping multi-select group without client-side truncation", async () => {
  const source = await readFile(new URL("./SuggestedRepliesPopover.tsx", import.meta.url), "utf8");

  assert.match(source, /role="group"/);
  assert.match(source, /flexWrap: "wrap"/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /chat\.insertSelectedReplies/);
  assert.doesNotMatch(source, /suggestions\.slice\(0,\s*4\)/);
});
