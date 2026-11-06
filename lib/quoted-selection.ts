/** Selected text as a Markdown blockquote, then a blank line to type after. */
export function buildQuotedSelection(text: string, intro?: string, question?: string): string {
  const quote = text.trim().split("\n").map((line) => `> ${line}`).join("\n");
  if (intro === undefined && question === undefined) return `${quote}\n\n`;
  return `${intro ?? ""}\n\n${quote}\n\n${question ?? ""}`;
}

/** What goes before a quote inserted after `before`, so the quote starts a paragraph of its own. */
export function quoteSeparator(before: string): string {
  if (!before.trim() || before.endsWith("\n\n")) return "";
  return before.endsWith("\n") ? "\n" : "\n\n";
}
