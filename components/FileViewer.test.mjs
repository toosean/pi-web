import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { FileViewer } = await jiti.import("./FileViewer.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

function renderViewer(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(FileViewer, props),
    ),
  );
}

test("FileViewer image viewer renders fullscreen button before download link", () => {
  const html = renderViewer({ filePath: "test.png" });

  assert.match(html, /file-viewer-wrapper/);
  assert.match(html, /title="Fullscreen preview".*?title="Download file"/);
});

test("FileViewer document viewer renders fullscreen button before download link", () => {
  const html = renderViewer({ filePath: "test.pdf" });

  assert.match(html, /file-viewer-wrapper/);
  assert.match(html, /title="Fullscreen preview".*?title="Download file"/);
});

test("FileViewer audio viewer renders fullscreen button before download link", () => {
  const html = renderViewer({ filePath: "test.mp3" });

  assert.match(html, /file-viewer-wrapper/);
  assert.match(html, /title="Fullscreen preview".*?title="Download file"/);
});

test("large source previews bypass the per-line syntax highlighter", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  assert.match(source, /const useLightweightSource = lines\.length > SOURCE_HIGHLIGHT_MAX_LINES;/);

  const lightweightStart = source.indexOf(") : useLightweightSource ? (");
  const syntaxStart = source.indexOf("<SyntaxHighlighter", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(syntaxStart, -1);

  const lightweightSource = source.slice(lightweightStart, syntaxStart);
  assert.match(lightweightSource, /className="file-source-view is-lightweight"/);
  assert.match(lightweightSource, /lines\.map\(\(line, lineIndex\) =>/);
  assert.match(lightweightSource, /className="file-source-line"/);
  assert.match(lightweightSource, /className="file-source-line-content"/);
  assert.match(lightweightSource, /style=\{FILE_LINE_NUMBER_STYLE\}/);
});
