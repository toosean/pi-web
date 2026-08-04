// Client-side session data cache.
//
// Switching sessions in the sidebar remounts <ChatWindow> (key bump), which
// re-fetches + re-parses the full session .jsonl every time. This module
// caches the last loaded SessionData per session id so switching back to a
// session we already loaded renders instantly, then revalidates in the
// background (see useAgentSession's cache fast path).
//
// Safety rules:
//  - Entries expire after TTL_MS (module-level Map survives SPA navigation).
//  - A session that was still running when its ChatWindow unmounted is
//    invalidated on unmount, so switching back never serves a stale snapshot
//    of a run that kept writing to the .jsonl file.
//  - The background revalidate always runs after a cache hit, so external
//    modifications (e.g. the TUI writing the same file) are picked up.

import type { SessionData } from "./types";

interface SessionCacheEntry {
  data: SessionData;
  ts: number;
}

const cache = new Map<string, SessionCacheEntry>();
const TTL_MS = 30_000;
const MAX_ENTRIES = 50;

export function getCachedSession(sid: string): SessionData | null {
  const entry = cache.get(sid);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(sid);
    return null;
  }
  return entry.data;
}

export function cacheSession(sid: string, data: SessionData): void {
  if (cache.size >= MAX_ENTRIES) {
    // Map iteration follows insertion order — evict the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(sid, { data, ts: Date.now() });
}

export function invalidateSessionCache(sid: string): void {
  cache.delete(sid);
}
