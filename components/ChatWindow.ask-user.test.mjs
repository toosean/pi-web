import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The form only mounts when the chat tells MessageView that this turn may take
// answers: MarkdownBody renders the fence's source otherwise. The v0.15.0
// ChatWindow lost that wiring, so every ask-user block showed as code.
test("the chat hands the newest unanswered form its interactive mode", async () => {
  const windowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  assert.match(windowSource, /const activeAskUserIdx = getActiveAskUserMessageIndex\(messages\)/);
  assert.match(windowSource, /const canAnswerAskUser = !sessionBusy && !isCompacting && !isStreaming/);
  assert.match(windowSource, /idx === activeAskUserIdx && canAnswerAskUser \? "interactive" : "readonly"/);
  assert.match(windowSource, /askUserMode=\{askUserMode\}/);
  assert.match(windowSource, /onInsertAskUserAnswers=\{askUserMode === "interactive" \? insertAskUserAnswers : undefined\}/);
  // The answers go to the composer and are sent by the user.
  assert.match(windowSource, /input\.prependText\(answer\)/);
  assert.match(inputSource, /prependText: \(text: string\) => void/);
});

test("the read-only summary keeps its answers out of the composer", async () => {
  const markdownSource = await readFile(new URL("./MarkdownBody.tsx", import.meta.url), "utf8");
  assert.match(markdownSource, /if \(lang === ASK_USER_LANGUAGE && !isStreaming && askUserMode\)/);
  assert.match(markdownSource, /interactive=\{askUserMode === "interactive"\}/);
});
