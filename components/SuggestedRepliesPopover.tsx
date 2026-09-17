"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SuggestedRepliesResponse } from "@/lib/api-types";

export interface SuggestedRepliesTarget {
  sessionId: string;
  entryId: string;
  anchor: HTMLButtonElement;
}

interface CachedReplies {
  suggestions: string[];
}

interface RequestState {
  key: string;
  loading: boolean;
  error: string | null;
}

interface Props {
  target: SuggestedRepliesTarget | null;
  onClose: () => void;
  onInsert: (suggestion: string) => boolean;
}

const MAX_CACHED_MESSAGES = 100;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

function targetKey(target: SuggestedRepliesTarget): string {
  return `${target.sessionId}:${target.entryId}`;
}

export function toggleSuggestedReplySelection(
  selected: ReadonlySet<string>,
  suggestion: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(suggestion)) next.delete(suggestion);
  else next.add(suggestion);
  return next;
}

export function joinSelectedSuggestedReplies(
  suggestions: readonly string[],
  selected: ReadonlySet<string>,
): string {
  return suggestions.filter((suggestion) => selected.has(suggestion)).join("; ");
}

export function SuggestedRepliesPopover({ target, onClose, onInsert }: Props) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef<Map<string, CachedReplies>>(new Map());
  const requestRef = useRef<{ key: string; id: number; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);
  const [, setCacheRevision] = useState(0);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [selectedReplies, setSelectedReplies] = useState<Set<string>>(new Set());

  const updateCache = useCallback((key: string, value: CachedReplies) => {
    const next = new Map(cacheRef.current);
    next.delete(key);
    next.set(key, value);
    while (next.size > MAX_CACHED_MESSAGES) {
      const oldest = next.keys().next().value;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    cacheRef.current = next;
    setCacheRevision((revision) => revision + 1);
  }, []);

  const loadReplies = useCallback(async (nextTarget: SuggestedRepliesTarget, refresh = false) => {
    const key = targetKey(nextTarget);
    if (!refresh && cacheRef.current.has(key)) return;
    if (refresh) setSelectedReplies(new Set());

    requestRef.current?.controller.abort();
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    requestRef.current = { key, id, controller };
    setRequestState({ key, loading: true, error: null });

    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(nextTarget.sessionId)}/entries/${encodeURIComponent(nextTarget.entryId)}/suggested-replies`,
        { method: "POST", signal: controller.signal },
      );
      const payload = await response.json().catch(() => null) as (SuggestedRepliesResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (!payload || !Array.isArray(payload.suggestions) || payload.suggestions.length === 0) {
        throw new Error(t("chat.suggestedRepliesInvalid"));
      }
      if (requestRef.current?.id !== id) return;
      updateCache(key, {
        suggestions: payload.suggestions,
      });
      setRequestState({ key, loading: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.id !== id) return;
      setRequestState({
        key,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (requestRef.current?.id === id) requestRef.current = null;
    }
  }, [t, updateCache]);

  const key = target ? targetKey(target) : null;
  const cached = key ? cacheRef.current.get(key) : undefined;
  const loading = Boolean(key && requestState?.key === key && requestState.loading);
  const error = key && requestState?.key === key ? requestState.error : null;

  useEffect(() => {
    setSelectedReplies(new Set());
  }, [key]);

  useEffect(() => {
    if (!target) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      return;
    }
    const activeKey = targetKey(target);
    if (!cacheRef.current.has(activeKey)) void loadReplies(target);
    return () => {
      if (requestRef.current?.key === activeKey) {
        requestRef.current.controller.abort();
        requestRef.current = null;
      }
    };
  }, [target, loadReplies]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover || !target) return;
    const viewport = window.visualViewport;
    const position = () => {
      if (!target.anchor.isConnected) {
        onClose();
        return;
      }
      const anchorRect = target.anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const minTop = viewportTop + VIEWPORT_MARGIN;
      const maxTop = viewportTop + viewportHeight - popoverRect.height - VIEWPORT_MARGIN;
      const preferredTop = anchorRect.top - popoverRect.height - POPOVER_GAP;
      const belowTop = anchorRect.bottom + POPOVER_GAP;
      const top = preferredTop >= minTop ? preferredTop : Math.min(belowTop, maxTop);
      const minLeft = viewportLeft + VIEWPORT_MARGIN;
      const maxLeft = viewportLeft + viewportWidth - popoverRect.width - VIEWPORT_MARGIN;
      const left = Math.max(minLeft, Math.min(anchorRect.right - popoverRect.width, maxLeft));
      popover.style.top = `${Math.max(minTop, top)}px`;
      popover.style.left = `${left}px`;
      popover.style.visibility = "visible";
    };

    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    observer.observe(target.anchor);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [target, cached?.suggestions, error, loading, onClose]);

  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (event: PointerEvent) => {
      const node = event.target as Node;
      if (popoverRef.current?.contains(node) || target.anchor.contains(node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      target.anchor.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [target, onClose]);

  if (!target || typeof document === "undefined") return null;

  const selectedText = cached
    ? joinSelectedSuggestedReplies(cached.suggestions, selectedReplies)
    : "";
  const insertSelectedReplies = () => {
    if (!selectedText || !onInsert(selectedText)) return;
    setSelectedReplies(new Set());
    onClose();
  };

  return createPortal(
    <div
      id="suggested-replies-popover"
      ref={popoverRef}
      role="dialog"
      aria-label={t("chat.suggestedReplies")}
      aria-busy={loading}
      style={{
        position: "fixed",
        top: target.anchor.getBoundingClientRect().bottom + POPOVER_GAP,
        left: target.anchor.getBoundingClientRect().left,
        zIndex: 135,
        visibility: "hidden",
        display: "flex",
        flexDirection: "column",
        width: "min(360px, calc(100vw - 16px))",
        maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
        overflow: "hidden",
        padding: 8,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28, padding: "0 2px 6px" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}>
          {t("chat.suggestedReplies")}
        </span>
        {cached && (
          <button
            type="button"
            className="file-viewer-icon-button"
            title={t("chat.refreshSuggestedReplies")}
            aria-label={t("chat.refreshSuggestedReplies")}
            disabled={loading}
            onClick={() => void loadReplies(target, true)}
            style={{ width: 26, height: 26, border: "none" }}
          >
            <svg className={loading ? "animate-spin" : undefined} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.3-2.6L20 9M4 15l2.6 2.6A7 7 0 0 0 17.9 15" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="file-viewer-icon-button"
          title={t("i18n.close")}
          aria-label={t("i18n.close")}
          onClick={onClose}
          style={{ width: 26, height: 26, border: "none" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      {!cached && !error && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 72, padding: "12px 10px", color: "var(--text-muted)", fontSize: 12 }}>
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
          {t("chat.generatingSuggestedReplies")}
        </div>
      )}

      {cached && (
        <div
          role="group"
          aria-label={t("chat.suggestedReplies")}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 6, minHeight: 0, overflowY: "auto", padding: "2px" }}
        >
          {cached.suggestions.map((suggestion) => {
            const selected = selectedReplies.has(suggestion);
            return (
              <button
                key={suggestion}
                type="button"
                disabled={loading}
                aria-pressed={selected}
                onClick={() => setSelectedReplies((current) => toggleSuggestedReplySelection(current, suggestion))}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "5px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: selected ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))" : "var(--bg-panel)",
                  color: selected ? "var(--accent)" : "var(--text)",
                  cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.65 : 1,
                  textAlign: "left",
                  fontSize: 12,
                  lineHeight: 1.4,
                  overflowWrap: "anywhere",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 15px",
                    width: 15,
                    height: 15,
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 3,
                  }}
                >
                  {selected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m2 6 2.5 2.5L10 3" /></svg>}
                </span>
                <span>{suggestion}</span>
              </button>
            );
          })}
        </div>
      )}

      {cached && (
        <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0, marginTop: 8, padding: "8px 2px 0", borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            disabled={loading || selectedReplies.size === 0}
            onClick={insertSelectedReplies}
            style={{
              minHeight: 28,
              padding: "5px 10px",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              background: "var(--accent)",
              color: "var(--accent-contrast)",
              cursor: loading || selectedReplies.size === 0 ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              opacity: loading || selectedReplies.size === 0 ? 0.45 : 1,
            }}
          >
            {t("chat.insertSelectedReplies", { count: selectedReplies.size })}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: cached ? 6 : 0, padding: "8px 9px", color: "#dc2626", fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{error}</span>
          <button
            type="button"
            onClick={() => void loadReplies(target, true)}
            style={{ flexShrink: 0, padding: 0, border: "none", background: "none", color: "inherit", cursor: "pointer", fontWeight: 600 }}
          >
            {t("chat.retrySuggestedReplies")}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
