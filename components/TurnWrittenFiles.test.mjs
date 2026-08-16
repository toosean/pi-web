import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

test("renders a collapsible card per turn showing modified files count and list", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    defaultExpanded: true,
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, />2<\/span>/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});
