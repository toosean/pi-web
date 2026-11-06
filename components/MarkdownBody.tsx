"use client";

import { createContext, memo, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import {
  isExternalMarkdownHref,
  jumpToMarkdownFragment,
  markdownAppUrlTransform,
  markdownRehypePlugins,
  markdownRemarkPlugins,
  markdownUrlTransform,
  markdownUserRemarkPlugins,
  normalizeDisplayMath,
  replaceLocalhostUrl,
} from "@/lib/markdown";
import { splitMarkdownBlocks } from "@/lib/markdown-blocks";
import { ASK_USER_LANGUAGE, parseAskUserBlock } from "@/lib/ask-user";
import { AskUserBlock } from "./AskUserBlock";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { SvgBlock } from "./SvgBlock";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  askUserMode?: "interactive" | "readonly";
  onInsertAskUserAnswers?: (answer: string) => boolean;
  /** Render every line ending as a line break, for text the user typed. */
  keepLineBreaks?: boolean;
  /** A document reader's own links: relative paths and `#headings` stay in the reader. */
  onNavigateLink?: (href: string) => void;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

interface MarkdownBlockProps {
  markdown: string;
  remarkPlugins: typeof markdownRemarkPlugins;
  urlTransform: typeof markdownUrlTransform;
  components: Components;
}

/** One parse; skipped while its text and renderers stay the same. */
const MarkdownBlock = memo(function MarkdownBlock({ markdown, remarkPlugins, urlTransform, components }: MarkdownBlockProps) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={markdownRehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
});

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onNavigateLink, askUserMode, onInsertAskUserAnswers, keepLineBreaks }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // A streaming reply grows by a few characters per chunk; parsing all of it
  // each time made a long reply quadratic. Its finished blocks keep their
  // parse and only the last is parsed again. A finished message is one block.
  const blocks = useMemo(
    () => (isStreaming ? splitMarkdownBlocks(normalizedMarkdown) : [normalizedMarkdown]),
    [isStreaming, normalizedMarkdown],
  );
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
        if (lang === "svg") {
          return <SvgBlock code={code} isStreaming={isStreaming} />;
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
      if (onNavigateLink && href && !isExternalMarkdownHref(href)) {
        // No href: a middle-click or "Open in new tab" would load the path on the app's own URL.
        const navigate = () => onNavigateLink(href);
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a {...props} role="link" tabIndex={0} onClick={navigate} onKeyDown={(event) => { if (event.key === "Enter") navigate(); }}>
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }
      if (href?.startsWith("#") && !onOpenFile) {
        // An in-page link: never a second tab of Pi Web.
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} onClick={jumpToMarkdownFragment}>
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const targetHref = href ? replaceLocalhostUrl(href) : href;
      const filePath = onOpenFile ? resolveLocalFileHref(targetHref, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={targetHref} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parsePdfPageFragment(href) ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={targetHref} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    ol({ node, start, style, ...props }) {
      // An outside marker wider than the list's left padding is clipped by
      // .markdown-body's overflow-x, so the padding follows the largest number.
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const digits = String(Math.abs((start ?? 1) + Math.max(items, 1) - 1)).length;
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: Math.max(digits, 2) }} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [askUserMode, cwd, isStreaming, onInsertAskUserAnswers, onNavigateLink, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          markdown={block}
          remarkPlugins={keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins}
          urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
          components={components}
        />
      ))}
    </div>
  );
});
