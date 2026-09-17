import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("keeps copy visible only on a completed turn's final answer on mobile", () => {
  assert.match(
    source,
    /renderMessage\(finalAssistantIdx, \{[\s\S]*?messageOverride: finalAnswerMessage,[\s\S]*?alwaysShowCopy: isMobile,[\s\S]*?writtenFiles/,
  );
  assert.match(source, /alwaysShowCopy=\{options\.alwaysShowCopy\}/);
  const processRenderStart = source.indexOf("processViews.push(renderMessage(processIdx, {");
  const processRenderEnd = source.indexOf("}));", processRenderStart);
  assert.notEqual(processRenderStart, -1);
  assert.notEqual(processRenderEnd, -1);
  assert.doesNotMatch(source.slice(processRenderStart, processRenderEnd), /alwaysShowCopy:/);
  assert.doesNotMatch(
    source,
    /<MessageView message=\{streamState\.streamingMessage as AgentMessage\}[^>]*alwaysShowCopy/,
  );
});

test("offers suggested replies only on each completed turn's final answer", () => {
  assert.match(
    source,
    /renderMessage\(finalAssistantIdx, \{[\s\S]*?messageOverride: finalAnswerMessage,[\s\S]*?showSuggestedReplies: true,[\s\S]*?alwaysShowSuggestedReplies: isMobile/,
  );
  assert.match(source, /onSuggestReplies=\{options\.showSuggestedReplies \? openSuggestedReplies : undefined\}/);
  const processRenderStart = source.indexOf("processViews.push(renderMessage(processIdx, {");
  const processRenderEnd = source.indexOf("}));", processRenderStart);
  assert.notEqual(processRenderStart, -1);
  assert.notEqual(processRenderEnd, -1);
  assert.doesNotMatch(source.slice(processRenderStart, processRenderEnd), /showSuggestedReplies:/);
  assert.doesNotMatch(
    source,
    /<MessageView message=\{streamState\.streamingMessage as AgentMessage\}[^>]*onSuggestReplies/,
  );
});

test("guards the closed suggested-replies target while entry ids catch up", () => {
  assert.match(
    source,
    /suggestedRepliesOpen=\{Boolean\([\s\S]*?options\.showSuggestedReplies[\s\S]*?&& suggestedRepliesTarget[\s\S]*?&& suggestedRepliesTarget\.entryId === entryIds\[idx\][\s\S]*?&& suggestedRepliesTarget\.sessionId ===/,
  );
  assert.doesNotMatch(
    source,
    /suggestedRepliesTarget\?\.entryId === entryIds\[idx\] && suggestedRepliesTarget\.sessionId/,
  );
});
