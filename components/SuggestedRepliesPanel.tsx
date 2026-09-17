"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SuggestedRepliesResponse } from "@/lib/api-types";

export interface SuggestedRepliesTarget {
  sessionId: string;
  entryId: string;
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
  target: SuggestedRepliesTarget;
  onClose: () => void;
  onInsert: (suggestion: string) => boolean;
}

const MAX_CACHED_MESSAGES = 100;
const suggestedRepliesCache = new Map<string, CachedReplies>();

function targetKey(target: SuggestedRepliesTarget): string {
  return `${target.sessionId}:${target.entryId}`;
}

function updateSuggestedRepliesCache(key: string, value: CachedReplies): void {
  suggestedRepliesCache.delete(key);
  suggestedRepliesCache.set(key, value);
  while (suggestedRepliesCache.size > MAX_CACHED_MESSAGES) {
    const oldest = suggestedRepliesCache.keys().next().value;
    if (oldest === undefined) break;
    suggestedRepliesCache.delete(oldest);
  }
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

export function SuggestedRepliesPanel({ target, onClose, onInsert }: Props) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<{ key: string; id: number; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);
  const [, setCacheRevision] = useState(0);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [selectedReplies, setSelectedReplies] = useState<Set<string>>(new Set());

  const loadReplies = useCallback(async (nextTarget: SuggestedRepliesTarget, refresh = false) => {
    const key = targetKey(nextTarget);
    if (!refresh && suggestedRepliesCache.has(key)) return;
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
      updateSuggestedRepliesCache(key, { suggestions: payload.suggestions });
      setCacheRevision((revision) => revision + 1);
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
  }, [t]);

  const { sessionId, entryId } = target;
  const key = targetKey(target);
  const cached = suggestedRepliesCache.get(key);
  const loading = Boolean(requestState?.key === key && requestState.loading);
  const error = requestState?.key === key ? requestState.error : null;

  useEffect(() => {
    const existing = suggestedRepliesCache.get(key);
    if (existing) {
      suggestedRepliesCache.delete(key);
      suggestedRepliesCache.set(key, existing);
    } else {
      void loadReplies({ sessionId, entryId });
    }

    return () => {
      if (requestRef.current?.key === key) {
        requestRef.current.controller.abort();
        requestRef.current = null;
      }
    };
  }, [entryId, key, loadReplies, sessionId]);

  useLayoutEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [key, cached?.suggestions, error, loading]);

  const selectedText = cached
    ? joinSelectedSuggestedReplies(cached.suggestions, selectedReplies)
    : "";
  const insertSelectedReplies = () => {
    if (!selectedText || !onInsert(selectedText)) return;
    setSelectedReplies(new Set());
    onClose();
  };

  return (
    <div
      id="suggested-replies-panel"
      ref={panelRef}
      role="region"
      aria-label={t("chat.suggestedReplies")}
      aria-busy={loading}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
        marginTop: 8,
        padding: 8,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-panel)",
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
          style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 6, minHeight: 0, maxHeight: 220, overflowY: "auto", padding: "2px" }}
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
                  background: selected ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))" : "var(--bg)",
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
    </div>
  );
}
