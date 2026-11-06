/**
 * A fenced ```svg block becomes an <img> document.
 *
 * The markup is rendered as an image, never injected into the page: an SVG
 * loaded through <img> runs no script and fetches no external resource, the
 * same guarantee `app/api/files` gets from the CSP it sends with a repo-owned
 * .svg file. `dangerouslySetInnerHTML` would run a copied SVG in the Pi Web
 * origin, where it can call any /api route.
 */

const SVG_ROOT = /<svg(?=[\s/>])/i;
const SVG_CLOSE = "</svg>";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The fence's markup as a standalone SVG document, or null when it holds none. */
export function svgDocumentFromFence(code: string): string | null {
  const start = SVG_ROOT.exec(code);
  if (!start) return null;
  const from = start.index;
  // Text around the root (an XML prolog, a doctype, a sentence the model left
  // outside the fence's tag) is dropped: only one document can be an image.
  const close = lastClosingTag(code);
  if (close && close.index > from) return ensureIntrinsicSize(ensureNamespace(code.slice(from, close.index + close.length)));
  const rootEnd = findTagEnd(code, from);
  if (rootEnd < 0) return null;
  const rootTag = code.slice(from, rootEnd + 1);
  // A fence that never closed its root tag keeps its content: an image loader
  // reports the malformed part as an error instead of showing an empty box.
  const document = /\/\s*>$/.test(rootTag) ? rootTag : `${code.slice(from).trimEnd()}${SVG_CLOSE}`;
  return ensureIntrinsicSize(ensureNamespace(document));
}

export function svgDataUrl(document: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(document)}`;
}

/** Index of the `>` that closes the tag starting at `from`, ignoring quoted values. */
function findTagEnd(text: string, from: number): number {
  let quote = "";
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

/** The last `</svg>` (XML allows whitespace before its `>`), with its start and length. */
function lastClosingTag(code: string): { index: number; length: number } | null {
  let last: { index: number; length: number } | null = null;
  for (const match of code.matchAll(/<\/svg\s*>/gi)) {
    last = { index: match.index ?? 0, length: match[0].length };
  }
  return last;
}

/** An SVG document without xmlns is parsed as HTML by an image loader. */
function ensureNamespace(document: string): string {
  const rootEnd = findTagEnd(document, 0);
  if (rootEnd < 0) return document;
  const rootTag = document.slice(0, rootEnd + 1);
  if (/(?:^|\s)xmlns\s*=/i.test(rootTag)) return document;
  return `${document.slice(0, "<svg".length)} xmlns="${SVG_NAMESPACE}"${document.slice("<svg".length)}`;
}

/**
 * An <img> whose SVG has a viewBox but no width/height has an intrinsic ratio
 * and no intrinsic size: it stretches to the whole message width, which turned
 * a 24px icon into a screen-filling one. Its viewBox is the size the author
 * drew it at, so that size becomes the image's width and height; CSS caps a
 * larger one at the message width.
 */
function ensureIntrinsicSize(document: string): string {
  const rootEnd = findTagEnd(document, 0);
  if (rootEnd < 0) return document;
  const rootTag = document.slice(0, rootEnd + 1);
  if (/(?:^|\s)(?:width|height)\s*=/i.test(rootTag)) return document;
  const viewBox = /(?:^|\s)viewBox\s*=\s*["']\s*[-\d.eE+]+[\s,]+[-\d.eE+]+[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/i.exec(rootTag);
  if (!viewBox) return document;
  const [, width, height] = viewBox;
  if (!(Number(width) > 0) || !(Number(height) > 0)) return document;
  const end = /\/\s*>$/.test(rootTag) ? rootTag.lastIndexOf("/") : rootTag.length - 1;
  const before = document.slice(0, end);
  const separator = /\s$/.test(before) ? "" : " ";
  return `${before}${separator}width="${width}" height="${height}"${document.slice(end)}`;
}
