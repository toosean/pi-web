import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

test("replaces http://127.0.0.1 and http://localhost when NEXT_PUBLIC_REPLACEMENT_BASE_URL is configured", () => {
  const markdown = "Check `http://127.0.0.1:3000/api` and [link](http://localhost:8080/test).";
  const saved = process.env.NEXT_PUBLIC_REPLACEMENT_BASE_URL;

  // Unconfigured: stays unchanged
  delete process.env.NEXT_PUBLIC_REPLACEMENT_BASE_URL;
  const htmlOriginal = renderMarkdown(markdown);
  assert.match(htmlOriginal, /<code class="markdown-inline-code">http:\/\/127\.0\.0\.1:3000\/api<\/code>/);
  assert.match(htmlOriginal, /href="http:\/\/localhost:8080\/test"/);

  // Configured: replaces localhost/127.0.0.1 and transforms inline code matching local URL into a Markdown link
  process.env.NEXT_PUBLIC_REPLACEMENT_BASE_URL = "http://mydomain";
  try {
    const htmlReplaced = renderMarkdown(markdown);
    assert.match(htmlReplaced, /<a href="http:\/\/mydomain:3000\/api" target="_blank" rel="noopener noreferrer">http:\/\/127\.0\.0\.1:3000\/api<\/a>/);
    assert.match(htmlReplaced, /<a href="http:\/\/mydomain:8080\/test" target="_blank" rel="noopener noreferrer">link<\/a>/);
  } finally {
    if (saved !== undefined) {
      process.env.NEXT_PUBLIC_REPLACEMENT_BASE_URL = saved;
    } else {
      delete process.env.NEXT_PUBLIC_REPLACEMENT_BASE_URL;
    }
  }
});
