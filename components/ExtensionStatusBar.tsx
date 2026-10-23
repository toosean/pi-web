"use client";

import { useState, useRef, useEffect } from "react";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { parseWebuiFooterPayload, type WebuiFooterPayload } from "@/lib/git-footer-types";
import { GitFooterWidget } from "./GitFooterWidget";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";

/**
 * `ctx.ui.setStatus("command:/mode toggle", "Build")` shows "Build" as a button
 * that sends `/mode toggle`. The command lives in the key because setStatus has
 * no room for it, and Pi's own footer prints only the text, so the same status
 * is still plain text there.
 */
export const EXTENSION_STATUS_COMMAND_PREFIX = "command:";

/** The slash command a status key asks for, or null for an ordinary status. */
export function extensionStatusCommand(key: string): string | null {
  if (!key.startsWith(EXTENSION_STATUS_COMMAND_PREFIX)) return null;
  const command = key.slice(EXTENSION_STATUS_COMMAND_PREFIX.length).trim();
  return command.length > 1 && command.startsWith("/") ? command : null;
}

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

function sortedStatuses(statuses: ExtensionStatusItem[]): ExtensionStatusItem[] {
  return [...statuses].sort((a, b) => a.key.localeCompare(b.key));
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return sortedStatuses(statuses)
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

type StatusCell =
  | { kind: "text"; text: string }
  | { kind: "command"; command: string; label: string };

/** One cell per status, in key order. A status with nothing visible to show has no cell. */
export function buildExtensionStatusCells(statuses: ExtensionStatusItem[]): StatusCell[] {
  const cells: StatusCell[] = [];
  for (const item of sortedStatuses(statuses)) {
    const text = sanitizeExtensionStatusText(item.text);
    const command = extensionStatusCommand(item.key);
    if (command) {
      const label = stripAnsi(text).replace(/\s+/g, " ").trim();
      cells.push({ kind: "command", command, label: label || command });
    } else if (stripAnsi(text).trim()) {
      cells.push({ kind: "text", text });
    }
  }
  return cells;
}

/**
 * The status line's markup, without hooks, so it can be rendered on its own
 * (and called directly in tests) separately from the shelf around it.
 */
export function ExtensionStatusLine({ cells, onCommand, commandsDisabled }: {
  cells: StatusCell[];
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  return (
    <div
      role="status"
      className="extension-status-line"
      aria-label={cells.map((cell) => (cell.kind === "text" ? stripAnsi(cell.text) : cell.label)).join(" ")}
      title={cells.map((cell) => (cell.kind === "text" ? stripAnsi(cell.text) : cell.label)).join(" ")}
    >
      <span className="extension-status-text">
        {cells.map((cell, index) => cell.kind === "text" ? (
          <span key={index} className="extension-status-item">
            <AnsiText text={cell.text} />
          </span>
        ) : (
          <button
            key={index}
            type="button"
            className="extension-status-item extension-status-command"
            disabled={!onCommand || commandsDisabled}
            title={`${cell.label} · ${cell.command}`}
            aria-label={`${cell.label} (${cell.command})`}
            onClick={() => onCommand?.(cell.command)}
          >
            {cell.label}
          </button>
        ))}
      </span>
    </div>
  );
}

export function ExtensionStatusBar({
  statuses = [],
  widgets = [],
  onCommand,
  commandsDisabled = false,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** Sends the command of a `command:` status; without it those buttons stay disabled. */
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Cells keep the `command:` statuses clickable; the local shelf keeps its own
  // git-footer widget and overflow toggle around them.
  const cells = buildExtensionStatusCells(filteredStatuses);
  const hasCommands = cells.some((cell) => cell.kind === "command");
  const plainStatusLine = cells
    .map((cell) => (cell.kind === "text" ? stripAnsi(cell.text) : cell.label))
    .join(" ");

  const statusLine = cells.length > 0 ? <ExtensionStatusLine cells={cells} onCommand={onCommand} commandsDisabled={commandsDisabled} /> : null;

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkOverflow = () => {
      const overflowing = el.scrollHeight > 36;
      setHasOverflow(overflowing);
      if (!overflowing && isExpanded) {
        setIsExpanded(false);
      }
    };

    checkOverflow();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(checkOverflow);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [statuses, widgets, webuiFooterPayload, isExpanded]);

  // Nothing to show: no visible cell (an empty status has none), no git-footer
  // payload and no widget.
  if (cells.length === 0 && !webuiFooterPayload && widgets.length === 0) return null;

  return (
    <div
      aria-label={plainStatusLine || undefined}
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${cells.length > 0 || webuiFooterPayload ? " has-status" : ""}${hasCommands ? " has-commands" : ""}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 6,
        paddingRight: hasOverflow ? 4 : 0,
      }}
    >
      <div
        ref={contentRef}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          maxHeight: isExpanded ? "none" : 35,
          overflow: "hidden",
          transition: "max-height 0.2s ease-in-out",
        }}
      >
        {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
        {webuiFooterPayload ? (
          <GitFooterWidget payload={webuiFooterPayload} />
        ) : (
          <span />
        )}
        {statusLine}
      </div>

      {hasOverflow && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? "\u6536\u8d77\u72b6\u6001\u680f" : "\u5c55\u5f00\u72b6\u6001\u680f"}
          aria-label={isExpanded ? "\u6536\u8d77\u72b6\u6001\u680f" : "\u5c55\u5f00\u72b6\u6001\u680f"}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            margin: "5px 4px 0 0",
            background: "transparent",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
            outline: "none",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease-in-out",
            }}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  );
}
