import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AskUserBlock } = await jiti.import("./AskUserBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const form = {
  version: 1,
  questions: [{
    prompt: "Deploy where?",
    options: [
      { label: "Staging", description: "Validate first.", recommended: true },
      { label: "Production", description: "Deploy live.", recommended: false },
    ],
  }],
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(AskUserBlock, { form, source: "version: 1\nquestions: []", interactive: true, onInsert: () => true, ...props }),
  ));
}

test("renders recommendations without preselecting them", () => {
  const html = render();
  assert.match(html, /data-ask-user-state="interactive"/);
  assert.match(html, />Recommended</);
  assert.match(html, />Other</);
  assert.match(html, /aria-label="View ask-user source"/);
  assert.match(html, /lucide-code-xml/);
  assert.doesNotMatch(html, />Source<\/button>/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /disabled=""[^>]*>Fill input/);
});

test("renders historical cards as read-only summaries", () => {
  const html = render({ interactive: false, onInsert: undefined });
  assert.match(html, /data-ask-user-state="readonly"/);
  assert.match(html, />Conversation continued</);
  assert.doesNotMatch(html, /<textarea/);
});
