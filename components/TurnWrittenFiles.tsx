"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * Lists the files a turn actually wrote, using a collapsible panel.
 * Entries come from the turn's successful `write`/`edit` tool calls
 * via extractTurnWrittenFiles.
 */
export function TurnWrittenFiles({
  files,
  cwd,
  onOpenFile,
  defaultExpanded = false,
}: {
  files: WrittenFile[];
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  if (files.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 8,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: 12,
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--accent)", flexShrink: 0 }}
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span style={{ fontWeight: 500, color: "var(--text)" }}>{t("chat.sessionModifiedFiles")}</span>
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 10,
            background: "rgba(37, 99, 235, 0.12)",
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          {files.length}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 4, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map(({ filePath }) => {
            const relativePath = cwd ? getRelativeFilePath(filePath, cwd) : getFileName(filePath);
            const isHovered = hoveredFile === filePath;
            const fullPath = resolveLocalFileHref(filePath, cwd) ?? filePath;
            return (
              <div
                key={filePath}
                onClick={() => onOpenFile?.(fullPath)}
                onMouseEnter={() => setHoveredFile(filePath)}
                onMouseLeave={() => setHoveredFile(null)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px",
                  borderRadius: 5,
                  color: isHovered ? "var(--text)" : "var(--text-muted)",
                  cursor: onOpenFile ? "pointer" : "default",
                  background: isHovered ? "var(--bg-hover)" : "transparent",
                  transition: "background 0.12s, color 0.12s",
                  wordBreak: "break-all",
                  width: "fit-content",
                  maxWidth: "100%",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {getFileIcon(filePath, 13)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    textDecoration: onOpenFile && isHovered ? "underline" : "none",
                  }}
                >
                  {relativePath}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
