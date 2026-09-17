import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  MessageView,
  ThinkingBlock,
  getModelDisplayName,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ToolInputFormatProvider } = await jiti.import("@/hooks/useToolInputFormat");
const { splitFinalAssistantBlocks } = await jiti.import("@/lib/message-display");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

function renderMessageInToolInputFormatProvider(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        ToolInputFormatProvider,
        null,
        React.createElement(MessageView, { message, ...props }),
      ),
    ),
  );
}

test("updates a reused message when its written files change", () => {
  const props = { message: { role: "assistant", content: [] } };
  assert.equal(MessageView.compare(props, props), true);
  assert.equal(MessageView.compare(props, { ...props, writtenFiles: [{ path: "/tmp/result.txt" }] }), false);
  assert.equal(MessageView.compare(props, { ...props, alwaysShowCopy: true }), false);
  assert.equal(MessageView.compare(props, { ...props, askUserMode: "readonly" }), false);
  assert.equal(MessageView.compare(props, { ...props, onInsertAskUserAnswers() {} }), false);
});

test("only renders assistant ask-user content as a form when given message context", () => {
  const markdown = `\`\`\`ask-user
version: 1
questions:
  - prompt: Deploy where?
    options:
      - label: Staging
        description: Validate first.
        recommended: true
      - label: Production
        description: Deploy live.
\`\`\``;
  const assistant = renderMessage({ role: "assistant", content: [{ type: "text", text: markdown }] }, {
    askUserMode: "interactive",
    onInsertAskUserAnswers() { return true; },
  });
  const user = renderMessage({ role: "user", content: markdown }, {
    askUserMode: "interactive",
    onInsertAskUserAnswers() { return true; },
  });

  assert.match(assistant, /data-ask-user-state="interactive"/);
  assert.doesNotMatch(user, /data-ask-user-state=/);
  assert.match(user, /class="markdown-code-lang">ask-user/);
});

test("can keep a completed assistant copy button visible without hover", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Copy this final answer" }],
  };
  const defaultHtml = renderMessage(message);
  const alwaysVisibleHtml = renderMessage(message, { alwaysShowCopy: true });

  assert.match(defaultHtml, /title="Copy message"[^>]*style="[^"]*opacity:0;pointer-events:none/);
  assert.match(alwaysVisibleHtml, /title="Copy message"[^>]*style="[^"]*opacity:1;pointer-events:auto/);
});

test("renders suggested replies only when a completed assistant entry has a handler", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Choose a next reply" }],
  };
  const withoutHandler = renderMessage(message, { entryId: "assistant-entry" });
  const withHandler = renderMessage(message, {
    entryId: "assistant-entry",
    onSuggestReplies() {},
  });
  const streaming = renderMessage(message, {
    entryId: "assistant-entry",
    onSuggestReplies() {},
    isStreaming: true,
  });

  assert.doesNotMatch(withoutHandler, /title="Reply ideas"/);
  assert.match(withHandler, /title="Reply ideas"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(streaming, /title="Reply ideas"/);
});

test("suggested replies visibility and open state participate in message memoization", () => {
  const props = {
    message: { role: "assistant", content: [{ type: "text", text: "Reply" }] },
    entryId: "assistant-entry",
    onSuggestReplies() {},
  };
  assert.equal(MessageView.compare(props, props), true);
  assert.equal(MessageView.compare(props, { ...props, alwaysShowSuggestedReplies: true }), false);
  assert.equal(MessageView.compare(props, { ...props, suggestedRepliesOpen: true }), false);
  assert.equal(MessageView.compare(props, { ...props, onSuggestReplies() {} }), false);

  const defaultHtml = renderMessage(props.message, props);
  const visibleHtml = renderMessage(props.message, { ...props, alwaysShowSuggestedReplies: true });
  const openHtml = renderMessage(props.message, { ...props, suggestedRepliesOpen: true });
  assert.match(defaultHtml, /title="Reply ideas"[^>]*style="[^"]*opacity:0;pointer-events:none/);
  assert.match(visibleHtml, /title="Reply ideas"[^>]*style="[^"]*opacity:1;pointer-events:auto/);
  assert.match(openHtml, /title="Reply ideas"[^>]*aria-expanded="true"[^>]*aria-controls="suggested-replies-popover"/);
});

test("renders completed message usage for desktop and a collapsed mobile trigger", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Done" }],
    usage: {
      input: 273,
      output: 1028,
      cacheRead: 31232,
      cacheWrite: 2048,
      cost: { total: 0.123456 },
    },
  });

  assert.match(html, /class="message-usage"/);
  assert.match(html, /class="message-usage-desktop">273 in · 1,028 out · 31,232 cache R · 2,048 cache W · \$0\.1235/);
  assert.match(html, /class="message-usage-trigger"/);
  assert.match(html, /aria-label="Usage details"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.doesNotMatch(html, /aria-describedby=/);
  assert.doesNotMatch(html, /role="tooltip"/);
});

test("does not render message usage while streaming or when usage is absent", () => {
  const usage = {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    cost: { total: 0.01 },
  };
  const streamingHtml = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "Streaming" }],
    usage,
  }, { isStreaming: true });
  const noUsageHtml = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "No usage" }],
  });

  assert.doesNotMatch(streamingHtml, /class="message-usage"/);
  assert.doesNotMatch(noUsageHtml, /class="message-usage"/);
});

test("matches response model aliases and otherwise includes the provider", () => {
  const names = {
    "gateway:claude-sonnet-5": "Sonnet 5",
    "custom-api:GLM-5.3": "GLM 5.3",
  };

  assert.equal(getModelDisplayName("gateway", "anthropic/claude-sonnet-5", names), "Sonnet 5");
  assert.equal(getModelDisplayName("CUSTOM-API", "glm-5.3", names), "GLM 5.3");
  assert.equal(getModelDisplayName("gateway", "unknown-model", names), "gateway/unknown-model");
});

test("previews the first thinking line and reveals the full text with the saved default", () => {
  const previousWindow = globalThis.window;
  try {
    for (const expanded of [false, true]) {
      globalThis.window = { localStorage: { getItem: () => String(expanded) } };
      const html = renderToStaticMarkup(React.createElement(
        I18nProvider,
        null,
        React.createElement(ThinkingBlock, {
          block: { type: "thinking", thinking: "**Independent reasoning**\n\nDetailed second line." },
          blockIndex: 2,
          duration: 3,
        }),
      ));
      assert.match(html, new RegExp(`aria-expanded="${expanded}"`));
      assert.equal((html.match(/>[^<]*Independent reasoning[^<]*</g) ?? []).length, 1);
      assert.equal(html.includes("Detailed second line."), expanded);
      assert.match(html, /aria-label="Thinking: /);
      assert.match(html, /3s/);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("shows deferred thinking previews without loading the full content", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Historical first line", deferred: true }],
  });
  assert.match(html, />Historical first line<\/span>/);
  assert.match(html, /aria-expanded="false"/);
});

test("marks only the matched text block after splitting thinking and the final answer", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "Thinking about the result" },
      { type: "text", text: "Process text" },
      { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
      { type: "text", text: "First answer" },
      { type: "text", text: "Matched pi-cwd-spark answer" },
    ],
  };
  const { processBlocks, answerBlocks } = splitFinalAssistantBlocks(message);
  for (const index of [2, 4, 5]) {
    const searchBlock = message.content[index];
    for (const content of [processBlocks, answerBlocks]) {
      const html = renderMessage({ ...message, content }, { searchBlock });
      assert.equal((html.match(/data-search-target="true"/g) ?? []).length, content.includes(searchBlock) ? 1 : 0);
      if (content.includes(searchBlock)) {
        assert.match(html, new RegExp(`data-search-target="true">(?:(?!data-message-text)[\\s\\S])*${searchBlock.text}`));
      }
    }
  }
});

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

test("formats tool arguments as YAML only through the exported helper", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-bash-yaml",
    toolName: "bash",
    input: { command: "printf 'a\nb\n' > f.txt" },
  };

  // The provider wraps the chat tree without changing the collapsed markup...
  const html = renderMessageInToolInputFormatProvider({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  });
  assert.match(html, />bash</);
  assert.doesNotMatch(html, /command: \|/);

  // ...and the format argument drives what the expanded box will show.
  assert.equal(getToolCallInputText(block, "yaml"), "command: |-\n  printf 'a\n  b\n  ' > f.txt");
  assert.equal(getToolCallInputText(block), '{\n  "command": "printf \'a\\nb\\n\' > f.txt"\n}');
});

test("renders subagents as standard tool calls with only an extra session button", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-agent-1",
    toolName: "Agent",
    input: {
      subagent_type: "Explore",
      prompt: "Find the parser",
      description: "Find parser",
    },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "Parser is in lib/parser.ts" }],
    details: {
      kind: "pi-web-subagent",
      sessionId: "child-session",
      profile: "Explore",
      description: "Find parser",
      status: "completed",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, result]]),
    onOpenSession() {},
  });

  assert.match(html, /border:1px solid rgba\(34,197,94,0\.25\)/);
  assert.match(html, />Agent</);
  assert.match(html, />Explore</);
  assert.match(html, /aria-label="Open sub-agent session"/);
  assert.doesNotMatch(html, />completed</);
  assert.doesNotMatch(html, />Find parser</);

  const ordinaryHtml = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ ...block, toolCallId: "call-extension-1", toolName: "extension_tool" }],
  }, {
    toolResults: new Map(),
    onOpenSession() {},
  });
  assert.doesNotMatch(ordinaryHtml, /Open sub-agent session/);
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("marks persisted assistant messages with their source entry", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Select this response" }],
  }, { entryId: "assistant-entry" });

  assert.match(html, /data-message-role="assistant"/);
  assert.match(html, /data-entry-id="assistant-entry"/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders an inline thumbnail button for read tool calls on image files", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-read-img",
    toolName: "read",
    input: { path: "assets/diagram.png" },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { cwd: "/my/project", sessionId: "sess-abc" });

  assert.match(html, /<button[^>]+aria-label="Open in file viewer"[^>]*>/);
  assert.match(html, /<img[^>]+src="\/api\/files\/my\/project\/assets\/diagram\.png\?type=read&amp;sessionId=sess-abc"/);
});
