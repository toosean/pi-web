"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { parseWebuiFooterPayload, type WebuiFooterPayload } from "@/lib/git-footer-types";
import { GitFooterWidget } from "./GitFooterWidget";
import { ExtensionWidgets } from "./ExtensionWidgets";

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

export function ExtensionStatusBar({
  statuses = [],
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
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

  const statusLine = formatExtensionStatusLine(filteredStatuses);
  const plainStatusLine = stripAnsi(statusLine);

  if (filteredStatuses.length === 0 && !webuiFooterPayload && widgets.length === 0) return null;

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${filteredStatuses.length > 0 || webuiFooterPayload ? " has-status" : ""}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {webuiFooterPayload && <GitFooterWidget payload={webuiFooterPayload} />}
      {filteredStatuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            {parseAnsiLine(statusLine).map((segment, index) => (
              <span key={index} style={segment.style}>{segment.text}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
