import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ASK_USER_OTHER_SELECTION,
  areAskUserAnswersComplete,
  createEmptyAskUserAnswers,
  formatAskUserAnswers,
  getActiveAskUserMessageIndex,
  isAskUserAnswerComplete,
  parseAskUserBlock,
} = await jiti.import("./ask-user.ts");

const validSource = `version: 1
questions:
  - prompt: Deploy where?
    options:
      - label: Staging
        description: Validate first.
        recommended: true
      - label: Production
        description: Deploy live.
  - prompt: Which release window?
    options:
      - label: Tonight
        description: Release after hours.
      - label: Tomorrow
        description: Release during the next window.
        recommended: true`;

test("parses the strict version 1 ask-user schema", () => {
  const form = parseAskUserBlock(validSource);
  assert.equal(form?.version, 1);
  assert.equal(form?.questions.length, 2);
  assert.equal(form?.questions[0].options[0].recommended, true);
  assert.equal(form?.questions[0].options[1].recommended, false);
});

test("rejects unknown fields and unsupported versions", () => {
  assert.equal(parseAskUserBlock(validSource.replace("version: 1", "version: 2")), null);
  assert.equal(parseAskUserBlock(`${validSource}\ntitle: Extra`), null);
  assert.equal(parseAskUserBlock(validSource.replace("prompt: Deploy where?", "prompt: Deploy where?\n    required: true")), null);
  assert.equal(parseAskUserBlock(validSource.replace("description: Validate first.", "description: Validate first.\n        value: staging")), null);
});

test("rejects malformed question and option counts", () => {
  assert.equal(parseAskUserBlock("version: 1\nquestions: []"), null);
  const sixQuestions = `version: 1\nquestions:\n${Array.from({ length: 6 }, (_, index) => `  - prompt: Q${index}?\n    options:\n      - label: A\n        description: A.\n        recommended: true\n      - label: B\n        description: B.`).join("\n")}`;
  assert.equal(parseAskUserBlock(sixQuestions), null);
  assert.equal(parseAskUserBlock(validSource.replace(/      - label: Production[\s\S]*?Deploy live\.\n/, "")), null);
  const tooManyOptions = validSource.replace(
    "      - label: Production\n        description: Deploy live.",
    "      - label: Production\n        description: Deploy live.\n      - label: Canary\n        description: Deploy a canary.\n      - label: Local\n        description: Deploy locally.\n      - label: Preview\n        description: Deploy a preview.",
  );
  assert.equal(parseAskUserBlock(tooManyOptions), null);
});

test("requires exactly one recommendation and unique labels", () => {
  assert.equal(parseAskUserBlock(validSource.replace("        recommended: true\n", "")), null);
  assert.equal(parseAskUserBlock(validSource.replace("        description: Deploy live.", "        description: Deploy live.\n        recommended: true")), null);
  assert.equal(parseAskUserBlock(validSource.replace("label: Production", "label: Staging")), null);
  assert.equal(parseAskUserBlock("version: ["), null);
});

test("tracks required answers without preselecting the recommendation", () => {
  const form = parseAskUserBlock(validSource);
  const answers = createEmptyAskUserAnswers(form);
  assert.deepEqual(answers, [
    { selection: null, supplement: "" },
    { selection: null, supplement: "" },
  ]);
  assert.equal(areAskUserAnswersComplete(form, answers), false);
  assert.equal(isAskUserAnswerComplete({ selection: 0, supplement: "" }), true);
  assert.equal(isAskUserAnswerComplete({ selection: ASK_USER_OTHER_SELECTION, supplement: "" }), false);
  assert.equal(isAskUserAnswerComplete({ selection: ASK_USER_OTHER_SELECTION, supplement: "Custom" }), true);
});

test("formats ordered readable Markdown and escapes generated structure", () => {
  const form = parseAskUserBlock(validSource);
  const result = formatAskUserAnswers(form, [
    { selection: 0, supplement: "Check *migrations*\nthen deploy" },
    { selection: ASK_USER_OTHER_SELECTION, supplement: "Next Friday" },
  ], {
    intro: "Here are my answers:",
    choice: "Choice",
    supplement: "Additional details",
    other: "Other",
    answer: "Answer",
    separator: ": ",
  });

  assert.equal(result, `Here are my answers:

1. **Deploy where?**
   - Choice: Staging
   - Additional details: Check \\*migrations\\*
     then deploy

2. **Which release window?**
   - Choice: Other
   - Answer: Next Friday`);
});

test("selects only the latest assistant message after the latest user message", () => {
  assert.equal(getActiveAskUserMessageIndex([]), -1);
  assert.equal(getActiveAskUserMessageIndex([{ role: "assistant" }]), 0);
  assert.equal(getActiveAskUserMessageIndex([{ role: "assistant" }, { role: "user" }]), -1);
  assert.equal(getActiveAskUserMessageIndex([
    { role: "user" },
    { role: "assistant" },
    { role: "toolResult" },
    { role: "assistant" },
  ]), 3);
});
