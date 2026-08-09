import assert from "node:assert/strict";
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
