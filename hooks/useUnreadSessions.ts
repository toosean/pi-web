"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { chunkForSessionUiRequests, normalizeSessionUiState, SESSION_ID_PATTERN } from "@/lib/session-ui-state-shared";
import type { SessionUiStateApi } from "./useSessionUiState";

const LEGACY_MIGRATED_KEY = "pi-web:session-flags-migrated";
const LEGACY_FLAGS = [
  { key: "pi-web:pinned-session-ids", flag: "pinned" },
  { key: "pi-web:hidden-session-ids", flag: "archived" },
  { key: "pi-web:unread-session-ids", flag: "unread" },
] as const;

/** The UI state's optimistic queue owns unread state, including refreshes and rollback. */
export function useUnreadSessions({ state, synced, apply }: Pick<SessionUiStateApi, "state" | "synced" | "apply">) {
  const unreadSessionIds = useMemo(() => new Set(state.unreadIds ?? []), [state.unreadIds]);
  const currentRef = useRef(unreadSessionIds);
  currentRef.current = unreadSessionIds;
  const importStarted = useRef(false);

  useEffect(() => {
    if (!synced || importStarted.current || typeof window === "undefined") return;
    importStarted.current = true;
    let storage: Storage;
    try {
      storage = window.localStorage;
      if (storage.getItem(LEGACY_MIGRATED_KEY)) return;
    } catch {
      return;
    }
    // Keep per-flag receipts: a failed hide import must not re-import pins that
    // already succeeded and were subsequently changed on another device.
    // Never write a live localStorage mirror. Failed flags retry after reload.
    void (async () => {
      let allImported = true;
      for (const { key, flag } of LEGACY_FLAGS) {
        try {
          if (storage.getItem(`${key}:imported`)) continue;
          const legacy: unknown = JSON.parse(storage.getItem(key) ?? "[]");
          if (!Array.isArray(legacy)) { allImported = false; continue; }
          const validIds = [...new Set(legacy.filter((id): id is string => typeof id === "string" && SESSION_ID_PATTERN.test(id)))];
          const ids = flag === "unread"
            ? normalizeSessionUiState({ version: 1, revision: 0, sessions: {}, projects: {}, unreadIds: validIds })?.unreadIds ?? []
            // Existing server flags take precedence over an old browser backup.
            : validIds.filter((id) => !state.sessions[id]);
          const change = flag === "pinned" ? { pinned: true } : flag === "archived" ? { archived: true } : { unread: true };
          const results = await Promise.all(chunkForSessionUiRequests(ids).map((part) => apply({ action: "set", ids: part, ...change })));
          if (results.some((ok) => !ok)) { allImported = false; continue; }
          storage.setItem(`${key}:imported`, "true");
          storage.removeItem(key);
        } catch { allImported = false; }
      }
      if (allImported) {
        try { storage.setItem(LEGACY_MIGRATED_KEY, "1"); } catch { /* Browser storage is optional. */ }
      }
    })();
  }, [synced, apply, state.sessions]);

  const updateUnread = useCallback((updater: (previous: Set<string>) => Set<string>) => {
    const previous = currentRef.current;
    const next = updater(previous);
    if (next === previous) return;
    currentRef.current = next;
    const added = [...next].filter((id) => !previous.has(id));
    const removed = [...previous].filter((id) => !next.has(id));
    for (const ids of chunkForSessionUiRequests(added)) void apply({ action: "set", ids, unread: true });
    for (const ids of chunkForSessionUiRequests(removed)) void apply({ action: "set", ids, unread: false });
  }, [apply]);

  return { unreadSessionIds, updateUnread };
}
