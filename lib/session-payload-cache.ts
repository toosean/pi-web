/**
 * Server-side cache for the derived payload of a single session file.
 *
 * `GET /api/sessions/[id]` re-read and re-parsed the whole `.jsonl` on every
 * request — including the plain "switch back to a session I already opened"
 * case, where the file has not changed at all. Session files grow to tens of
 * megabytes, so that parse dominates the request.
 *
 * This cache keys the derived result on the file's identity (path plus the
 * `mtimeMs`/`size`/`ctimeMs` triple taken from one `stat`) and on the request
 * parameters that change what is built, so an unchanged file is served without
 * opening a SessionManager. Appends change `size`, rewrites and renames change
 * `mtime`/path, so an unchanged key really means unchanged content.
 *
 * Only the read-only path may use this: a session with a live `AgentSession`
 * keeps mutable in-memory state that the file does not reflect.
 */

export interface SessionFileIdentity {
  filePath: string;
  mtimeMs: number;
  size: number;
  ctimeMs: number;
}

interface PayloadCacheEntry<T> {
  identity: SessionFileIdentity;
  params: string;
  payload: T;
  storedAt: number;
}

interface PayloadCacheState {
  entries: Map<string, PayloadCacheEntry<unknown>>;
}

declare global {
  var __piSessionPayloadCache: PayloadCacheState | undefined;
}

/** Cap on retained payloads; each holds a message tail plus the full tree. */
export const MAX_SESSION_PAYLOAD_ENTRIES = 12;
/** Safety net: even with an unchanged file, do not serve anything older. */
export const SESSION_PAYLOAD_MAX_AGE_MS = 5 * 60 * 1000;

function getState(): PayloadCacheState {
  if (!globalThis.__piSessionPayloadCache) {
    globalThis.__piSessionPayloadCache = { entries: new Map() };
  }
  return globalThis.__piSessionPayloadCache;
}

function sameIdentity(a: SessionFileIdentity, b: SessionFileIdentity): boolean {
  return a.filePath === b.filePath
    && a.mtimeMs === b.mtimeMs
    && a.size === b.size
    && a.ctimeMs === b.ctimeMs;
}

/**
 * Reads a cached payload for a file and parameter set. Entries are validated
 * against the caller's freshly stat'ed identity, so a stale entry can never be
 * served, and a mismatch drops the entry instead of leaking it.
 */
export function readSessionPayloadCache<T>(
  identity: SessionFileIdentity,
  params: string,
  now = Date.now(),
): T | null {
  const state = getState();
  const entry = state.entries.get(identity.filePath);
  if (!entry) return null;

  const fresh = entry.params === params
    && sameIdentity(entry.identity, identity)
    && now - entry.storedAt <= SESSION_PAYLOAD_MAX_AGE_MS;
  if (!fresh) {
    state.entries.delete(identity.filePath);
    return null;
  }

  // Refresh recency: Map iteration order is insertion order.
  state.entries.delete(identity.filePath);
  state.entries.set(identity.filePath, entry);
  return entry.payload as T;
}

export function writeSessionPayloadCache<T>(
  identity: SessionFileIdentity,
  params: string,
  payload: T,
  now = Date.now(),
): void {
  const state = getState();
  state.entries.delete(identity.filePath);
  state.entries.set(identity.filePath, { identity, params, payload, storedAt: now });
  while (state.entries.size > MAX_SESSION_PAYLOAD_ENTRIES) {
    const oldest = state.entries.keys().next().value;
    if (oldest === undefined) break;
    state.entries.delete(oldest);
  }
}

/** Drops one file's payload, or the whole cache when no path is given. */
export function invalidateSessionPayloadCache(filePath?: string): void {
  const state = getState();
  if (!filePath) {
    state.entries.clear();
    return;
  }
  state.entries.delete(filePath);
}

/** Test/observability helper. */
export function sessionPayloadCacheSize(): number {
  return getState().entries.size;
}
