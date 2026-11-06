import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { svgDocumentFromFence, svgDataUrl } = await createJiti(import.meta.url).import("./svg-preview.ts");

test("keeps the root element and drops what surrounds it", () => {
  const code = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- a comment the loader would keep, the prolog above it would not -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" /></svg>
trailing sentence`;

  const document = svgDocumentFromFence(code);

  assert.ok(document.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(document.endsWith("</svg>"));
  assert.doesNotMatch(document, /<\?xml|<!DOCTYPE|trailing sentence/);
});

test("adds the SVG namespace an image loader needs", () => {
  const document = svgDocumentFromFence('<svg viewBox="0 0 4 4"><path d="M0 0h4v4z"/></svg>');

  assert.equal(document, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" width="4" height="4"><path d="M0 0h4v4z"/></svg>');
  // An inherited xmlns, or one written after another attribute, is left alone.
  for (const code of [
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4z"/></svg>',
    "<svg class='a' xmlns='http://www.w3.org/2000/svg'><path d='M0 0h4v4z'/></svg>",
  ]) {
    assert.equal(svgDocumentFromFence(code), code);
  }
});

test("closes a truncated root tag so a self-closing or unfinished fence still previews", () => {
  assert.equal(
    svgDocumentFromFence('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>',
  );
  assert.equal(
    svgDocumentFromFence('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" />'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" />',
  );
});

test("a > inside a quoted attribute does not end the root tag", () => {
  const code = '<svg aria-label="a > b" viewBox="0 0 4 4"></svg >';

  assert.equal(svgDocumentFromFence(code), '<svg xmlns="http://www.w3.org/2000/svg" aria-label="a > b" viewBox="0 0 4 4" width="4" height="4"></svg >');
});

test("markup without an <svg> root has no preview", () => {
  for (const code of [
    "graph TD;\n  A-->B;",
    "<div>not an svg</div>",
    "<svgx></svgx>",
    "",
  ]) {
    assert.equal(svgDocumentFromFence(code), null);
  }
});

test("sizes an image by its viewBox instead of the message width", () => {
  // An <img> with a viewBox and no width/height has an intrinsic ratio but no
  // intrinsic size, which stretched a 24px icon across the whole message.
  assert.equal(
    svgDocumentFromFence('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"></svg>'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="24" height="24"></svg>',
  );
  assert.equal(
    svgDocumentFromFence('<svg viewBox="0 0 8 8" />'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"/>',
  );
  // A width, a height or no viewBox leaves the markup as written.
  for (const code of [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="40"><path d="M0 0h8v8z"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" height="40"><path d="M0 0h8v8z"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8z"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><path d="M0 0h8v8z"/></svg>',
  ]) {
    assert.equal(svgDocumentFromFence(code), code);
  }
});

test("the data URL keeps the markup as text", () => {
  assert.equal(
    svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>#1 & "2"</text></svg>'),
    "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%3E%231%20%26%20%222%22%3C%2Ftext%3E%3C%2Fsvg%3E",
  );
});

test("keeps an unclosed fence's content so the image loader reports it", () => {
  assert.equal(
    svgDocumentFromFence('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10">'),
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>',
  );
});
