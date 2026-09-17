"use client";

import { useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  markdownUrlTransform,
  normalizeDisplayMath,
  replaceLocalhostUrl,
} from "@/lib/markdown";
import { ASK_USER_LANGUAGE, parseAskUserBlock } from "@/lib/ask-user";
import { AskUserBlock } from "./AskUserBlock";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  askUserMode?: "interactive" | "readonly";
  onInsertAskUserAnswers?: (answer: string) => boolean;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, askUserMode, onInsertAskUserAnswers }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        const code = raw.replace(/\n$/, "");
        if (lang === ASK_USER_LANGUAGE && !isStreaming && askUserMode) {
          const form = parseAskUserBlock(code);
          if (form) {
            return (
              <AskUserBlock
                form={form}
                source={code}
                interactive={askUserMode === "interactive"}
                onInsert={onInsertAskUserAnswers}
              />
            );
          }
        }
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={code}
              isStreaming={isStreaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={code} lang={lang} isStreaming={isStreaming} />;
      }
      const replaced = replaceLocalhostUrl(raw);
      if (replaced !== raw && /^https?:\/\//i.test(replaced)) {
        return (
          <a href={replaced} target="_blank" rel="noopener noreferrer">
            {raw}
          </a>
        );
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {replaced}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const targetHref = href ? replaceLocalhostUrl(href) : href;
      const filePath = onOpenFile ? resolveLocalFileHref(targetHref, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={targetHref} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={targetHref} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [askUserMode, cwd, isStreaming, onInsertAskUserAnswers, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
