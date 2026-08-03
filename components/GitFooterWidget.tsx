"use client";

import { useState, useRef, useEffect } from "react";
import type { WebuiFooterChip, WebuiFooterPayload, WebuiFooterChangedFile } from "@/lib/git-footer-types";

function getToneStyles(tone?: string) {
  switch (tone) {
    case "pink":
      return {
        bg: "rgba(244, 114, 182, 0.12)",
        border: "rgba(244, 114, 182, 0.3)",
        text: "#ec4899",
      };
    case "blue":
      return {
        bg: "rgba(59, 130, 246, 0.12)",
        border: "rgba(59, 130, 246, 0.3)",
        text: "#3b82f6",
      };
    case "mauve":
      return {
        bg: "rgba(168, 85, 247, 0.12)",
        border: "rgba(168, 85, 247, 0.3)",
        text: "#a855f7",
      };
    case "yellow":
      return {
        bg: "rgba(234, 179, 8, 0.12)",
        border: "rgba(234, 179, 8, 0.3)",
        text: "#eab308",
      };
    case "green":
      return {
        bg: "rgba(34, 197, 94, 0.12)",
        border: "rgba(34, 197, 94, 0.3)",
        text: "#22c55e",
      };
    case "teal":
      return {
        bg: "rgba(20, 184, 166, 0.12)",
        border: "rgba(20, 184, 166, 0.3)",
        text: "#14b8a6",
      };
    default:
      return {
        bg: "rgba(128,128,128,0.08)",
        border: "rgba(128,128,128,0.2)",
        text: "var(--text-muted)",
      };
  }
}

function KindBadge({ kind }: { kind: WebuiFooterChangedFile["kind"] }) {
  const styles = {
    staged: { bg: "rgba(34, 197, 94, 0.15)", color: "#22c55e", label: "staged" },
    modified: { bg: "rgba(234, 179, 8, 0.15)", color: "#eab308", label: "modified" },
    untracked: { bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", label: "untracked" },
    conflicted: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444", label: "conflict" },
  }[kind] || { bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", label: kind };

  return (
    <span
      style={{
        padding: "1px 5px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "lowercase",
        backgroundColor: styles.bg,
        color: styles.color,
        fontFamily: "var(--font-mono)",
      }}
    >
      {styles.label}
    </span>
  );
}

function ChangedFilesPopover({
  files,
  filesTotal,
  filesTruncated,
  onClose,
}: {
  files: WebuiFooterChangedFile[];
  filesTotal?: number;
  filesTruncated?: boolean;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: "absolute",
        bottom: "100%",
        marginBottom: 6,
        left: 0,
        zIndex: 100,
        width: "max-content",
        maxWidth: 420,
        maxHeight: 280,
        overflowY: "auto",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        padding: "8px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          paddingBottom: 4,
          borderBottom: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontWeight: 600,
        }}
      >
        <span>Git Changed Files ({filesTotal ?? files.length})</span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "0 4px",
            fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {files.map((file, idx) => (
          <div
            key={`${file.path}-${idx}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 300,
              }}
              title={file.path}
            >
              {file.path}
            </span>
            <KindBadge kind={file.kind} />
          </div>
        ))}
      </div>
      {filesTruncated && (
        <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 10, fontStyle: "italic" }}>
          ... truncated ({filesTotal} total files)
        </div>
      )}
    </div>
  );
}

function ChipItem({ chip }: { chip: WebuiFooterChip }) {
  const [showFiles, setShowFiles] = useState(false);
  const toneStyle = getToneStyles(chip.tone);
  const hasFiles = Boolean(chip.files && chip.files.length > 0);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <div
        title={chip.title}
        onClick={() => {
          if (hasFiles) setShowFiles((prev) => !prev);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "2px 7px",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          backgroundColor: toneStyle.bg,
          border: `1px solid ${toneStyle.border}`,
          color: "var(--text)",
          cursor: hasFiles ? "pointer" : "default",
          userSelect: "none",
          whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}
      >
        {chip.icon && <span style={{ opacity: 0.85 }}>{chip.icon}</span>}
        {chip.label && (
          <span style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>
            {chip.label}
          </span>
        )}
        <span style={{ color: toneStyle.text, fontWeight: 600 }}>{chip.value}</span>

        {chip.contextUsage && chip.contextUsage.percent !== null && (
          <div
            style={{
              width: 28,
              height: 4,
              backgroundColor: "rgba(128,128,128,0.2)",
              borderRadius: 2,
              overflow: "hidden",
              marginLeft: 2,
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, chip.contextUsage.percent))}%`,
                height: "100%",
                backgroundColor:
                  chip.contextUsage.percent > 85
                    ? "#ef4444"
                    : chip.contextUsage.percent > 70
                    ? "#eab308"
                    : "#22c55e",
              }}
            />
          </div>
        )}
      </div>

      {showFiles && chip.files && (
        <ChangedFilesPopover
          files={chip.files}
          filesTotal={chip.filesTotal}
          filesTruncated={chip.filesTruncated}
          onClose={() => setShowFiles(false)}
        />
      )}
    </div>
  );
}

export function GitFooterWidget({ payload }: { payload: WebuiFooterPayload }) {
  const chips = [...payload.main, ...payload.meta];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        maxWidth: "100%",
        padding: "2px 0",
      }}
    >
      {chips.map((chip, index) => (
        <ChipItem key={`${chip.key}-${index}`} chip={chip} />
      ))}
    </div>
  );
}
