"use client";

import { useState, useRef, useEffect } from "react";
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

  const statusLine = [...filteredStatuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");

  const plainStatusLine = stripAnsi(statusLine);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkOverflow = () => {
      const overflowing = el.scrollHeight > 32;
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
  }, [statuses, webuiFooterPayload, isExpanded]);

  if (statuses.length === 0) return null;

  return (
    <div
      role="status"
      aria-label={plainStatusLine || undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 6,
        flexShrink: 0,
        minWidth: 0,
        minHeight: 36,
        padding: "6px 12px",
        borderTop: "1px solid var(--border)",
        background: "transparent",
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
          maxHeight: isExpanded ? "none" : 28,
          overflow: "hidden",
          transition: "max-height 0.2s ease-in-out",
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

      {hasOverflow && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? "收起状态栏" : "展开状态栏"}
          aria-label={isExpanded ? "收起状态栏" : "展开状态栏"}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            margin: 0,
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
