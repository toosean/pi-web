"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem } from "@/lib/types";
import { parseWebuiFooterPayload, type WebuiFooterPayload } from "@/lib/git-footer-types";
import { GitFooterWidget } from "./GitFooterWidget";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({ statuses }: { statuses: ExtensionStatusItem[] }) {
  if (statuses.length === 0) return null;

  let webuiFooterPayload: WebuiFooterPayload | null = null;
  const filteredStatuses: ExtensionStatusItem[] = [];

  for (const item of statuses) {
    if (item.key === "git-footer-webui" || item.text.trim().startsWith("{")) {
      const parsed = parseWebuiFooterPayload(item.text);
      if (parsed) {
        webuiFooterPayload = parsed;
        continue;
      }
    }
    if (item.key === "git-footer") {
      continue;
    }
    filteredStatuses.push(item);
  }

  if (!webuiFooterPayload) {
    for (const item of statuses) {
      if (item.key === "git-footer" && !filteredStatuses.includes(item)) {
        filteredStatuses.push(item);
      }
    }
  }

  const statusLine = [...filteredStatuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");

  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 6,
        flexShrink: 0,
        minWidth: 0,
        minHeight: 36,
        padding: "6px 12px",
        borderTop: "1px solid var(--border)",
        background: "transparent",
      }}
    >
      {webuiFooterPayload ? (
        <GitFooterWidget payload={webuiFooterPayload} />
      ) : (
        <span />
      )}

      {statusLine && (
        <span
          title={plainStatusLine}
          style={{
            minWidth: 0,
            overflow: "hidden",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {parseAnsiLine(statusLine).map((segment, index) => (
            <span key={index} style={segment.style}>{segment.text}</span>
          ))}
        </span>
      )}
    </div>
  );
}
