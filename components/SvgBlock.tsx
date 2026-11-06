"use client";

import { memo, useMemo, useState } from "react";
import { CodeXml, Download, Eye } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { svgDataUrl, svgDocumentFromFence } from "@/lib/svg-preview";
import { ImagePreview } from "./ImagePreview";
import { CodeBlock } from "./MermaidBlock";

interface SvgBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
}

/** Saves the fence's SVG document; the markup itself is the file. */
export function downloadSvgText(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "diagram.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A ```svg fence: the source through `CodeBlock`, its image through an <img>
 * data URL (`lib/svg-preview.ts` explains why it is never inlined).
 *
 * Like `MermaidBlock`, the preview waits for the stream to finish, so a fence
 * that is still growing renders as plain text until its markup is complete.
 */
export const SvgBlock = memo(function SvgBlock({ code, isStreaming, defaultPreview = false }: SvgBlockProps) {
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(defaultPreview);
  // An image that failed to load is remembered by its markup, so a later
  // message with valid SVG in the same block position previews again.
  const [brokenFor, setBrokenFor] = useState<string | null>(null);
  const svgDocument = useMemo(() => svgDocumentFromFence(code), [code]);
  const previewVisible = showPreview && !isStreaming && svgDocument !== null;
  const broken = previewVisible && brokenFor === code;

  const previewButton = useMemo(() => {
    const label = isStreaming
      ? t("i18n.previewAfterStreaming")
      : (previewVisible ? t("i18n.showSvgSource") : t("i18n.previewSvg"));
    return (
      <button
        type="button"
        onClick={() => setShowPreview((value) => !value)}
        disabled={isStreaming}
        title={label}
        aria-label={label}
        className="markdown-code-action is-icon"
      >
        {previewVisible
          ? <CodeXml aria-hidden="true" size={15} strokeWidth={2} />
          : <Eye aria-hidden="true" size={15} strokeWidth={2} />}
      </button>
    );
  }, [isStreaming, previewVisible, t]);

  if (!showPreview || isStreaming || !svgDocument) {
    return (
      <CodeBlock
        code={svgDocument ?? code.replace(/\n$/, "")}
        lang="svg"
        headerAction={svgDocument ? previewButton : undefined}
        isStreaming={isStreaming}
      />
    );
  }

  const src = svgDataUrl(svgDocument);
  return (
    <div className="markdown-code-block svg-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">svg</span>
        <div className="markdown-code-actions">
          <button
            type="button"
            className="markdown-code-action is-icon"
            title={`${t("i18n.downloadFile")} (SVG)`}
            aria-label={`${t("i18n.downloadFile")} (SVG)`}
            onClick={() => downloadSvgText(svgDocument)}
          >
            <Download aria-hidden="true" size={15} strokeWidth={2} />
          </button>
          {previewButton}
        </div>
      </div>
      {broken ? (
        <div className="mermaid-block mermaid-block-error">{t("i18n.invalidSvg")}</div>
      ) : (
        <ImagePreview
          src={src}
          alt={t("i18n.previewSvg")}
          className="svg-block-preview"
          style={{ padding: "12px" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="svg-block-image"
            src={src}
            alt=""
            loading="lazy"
            onError={() => setBrokenFor(code)}
          />
        </ImagePreview>
      )}
    </div>
  );
});
