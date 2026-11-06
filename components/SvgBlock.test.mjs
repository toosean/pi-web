import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SvgBlock, downloadSvgText } = await jiti.import("./SvgBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
  <rect x="0" y="0" width="120" height="40" fill="#4a90d9" />
  <text x="12" y="26" fill="#fff">hello</text>
</svg>`;

function renderSvg(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SvgBlock, props),
    ),
  );
}

test("SvgBlock renders source by default", () => {
  const html = renderSvg({ code: svgSrc });

  assert.match(html, /aria-label="Preview SVG"/);
  assert.match(html, /lucide-eye/);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /svg-block-image/);
});

test("SvgBlock previews the fence as an image by default", () => {
  const html = renderSvg({ code: svgSrc, defaultPreview: true });

  assert.match(html, /aria-label="Show SVG source"/);
  assert.match(html, /lucide-code-xml/);
  assert.match(html, /src="data:image\/svg\+xml;charset=utf-8,%3Csvg%20xmlns%3D/);
  assert.match(html, /class="svg-block-image"/);
  assert.doesNotMatch(html, /&lt;svg/);
});

test("SvgBlock adds the namespace a fence can leave out", () => {
  const html = renderSvg({ code: "<svg viewBox='0 0 1 1'><path d='M0 0h1v1z'/></svg>", defaultPreview: true });

  assert.match(html, /%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D/);
});

test("SvgBlock previews only after the stream finishes", () => {
  const html = renderSvg({ code: svgSrc, defaultPreview: true, isStreaming: true });

  assert.match(html, /disabled/);
  assert.match(html, /aria-label="Preview available after streaming"/);
  assert.match(html, /lucide-eye/);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /svg-block-image/);
});

test("SvgBlock offers no preview for markup without an <svg> root", () => {
  const html = renderSvg({ code: "graph TD;\n  A-->B;", defaultPreview: true });

  assert.doesNotMatch(html, /lucide-eye/);
  assert.match(html, />svg</);
  assert.match(html, /graph TD;/);
});

test("downloadSvgText saves the markup as an .svg file and releases its URL", async () => {
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const link = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
  let downloadedBlob;
  globalThis.document = { createElement: () => link };
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, "image/svg+xml;charset=utf-8");
    downloadedBlob = blob;
    return "blob:svg";
  };
  let revoked = null;
  URL.revokeObjectURL = (url) => { revoked = url; };

  try {
    downloadSvgText(svgSrc);
    assert.equal(await downloadedBlob.text(), svgSrc);
    assert.equal(link.href, "blob:svg");
    assert.equal(link.download, "diagram.svg");
    assert.equal(link.clicked, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(revoked, "blob:svg");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("every header action is an icon and none claims an active view", () => {
  const preview = renderSvg({ code: svgSrc, defaultPreview: true });
  // The language tag already says `svg`, so the download is an icon, and the
  // toggle points at the view it opens instead of highlighting the current one.
  assert.match(preview, /aria-label="Download file \(SVG\)"/);
  assert.match(preview, /aria-label="Show SVG source"/);
  assert.match(preview, /lucide-download/);
  assert.match(preview, /lucide-code-xml/);
  assert.doesNotMatch(preview, /is-active/);
  assert.doesNotMatch(preview, />Source</);

  const source = renderSvg({ code: svgSrc });
  assert.match(source, /aria-label="Preview SVG"/);
  assert.match(source, /lucide-eye/);
  assert.match(source, /lucide-copy/);
  assert.doesNotMatch(source, /lucide-download/);
});
