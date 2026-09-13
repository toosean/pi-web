/**
 * Session window registry.
 *
 * Since a session switch must no longer destroy its <ChatWindow>, AppShell keeps
 * one live window instance per visited session and only toggles which one is in
 * front. This module owns the retention policy as pure functions so it can be
 * unit tested without React:
 *
 *  - A window is evicted only when it is neither in front nor interacting.
 *  - Windows that have produced no activity for a while are evicted (LRU-ish
 *    idle timeout).
 *  - A hard cap keeps long click-throughs bounded; a window that is currently
 *    interacting is never evicted to satisfy the cap.
 *
 * Retention rules are documented in `docs/adr/0004-session-window-retention.md`.
 */

import type { SessionInfo } from "./types";

export interface SessionWindow {
  /** Stable React key. Never changes for the lifetime of the window. */
  windowId: string;
  /** `null` while the window is a fresh composer that pi has not persisted yet. */
  sessionId: string | null;
  /** Draft key used by `lib/draft-store.ts` for this window's composer. */
  draftKey: string;
  session: SessionInfo | null;
  /** Effective cwd. Draft windows are keyed to the cwd they will create in. */
  cwd: string | null;
  /** Timestamp this window was last in front, or last became idle after running. */
  lastActiveAt: number;
  /** Reported by the window: running, compacting, loading, waiting for input. */
  busy: boolean;
}

export interface SelectDestroyableOptions {
  now: number;
  activeWindowId: string | null;
  idleMs: number;
  maxWindows: number;
  maxDrafts: number;
  /**
   * Draft keys whose composer currently holds unsent content. Those windows are
   * interacting for retention purposes and are never evicted, except by the
   * separate `maxDrafts` cap (the text itself survives in the draft store).
   */
  draftKeysWithContent?: Iterable<string>;
}

export const SESSION_WINDOW_IDLE_MS = 10 * 60 * 1000;
export const SESSION_WINDOW_SWEEP_MS = 30 * 1000;
export const MAX_SESSION_WINDOWS = 8;
export const MAX_MOBILE_SESSION_WINDOWS = 4;
export const MAX_DRAFT_WINDOWS = 2;
export const SESSION_WINDOW_IDLE_OVERRIDE_KEY = "pi-web:session-window-idle-ms";
/** Guards the localStorage override so a typo cannot evict windows instantly. */
const MIN_IDLE_OVERRIDE_MS = 1000;

export function makeWindowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isDraftWindow(window: SessionWindow): boolean {
  return window.sessionId === null;
}

export function findWindowBySessionId(
  windows: readonly SessionWindow[],
  sessionId: string,
): SessionWindow | null {
  return windows.find((window) => window.sessionId === sessionId) ?? null;
}

export function findWindowByDraftKey(
  windows: readonly SessionWindow[],
  draftKey: string,
): SessionWindow | null {
  return windows.find((window) => window.draftKey === draftKey) ?? null;
}

export function getWindow(
  windows: readonly SessionWindow[],
  windowId: string | null,
): SessionWindow | null {
  if (!windowId) return null;
  return windows.find((window) => window.windowId === windowId) ?? null;
}

/** Opens (or re-focuses) the window for a persisted session. */
export function openSessionWindow(
  windows: readonly SessionWindow[],
  options: { windowId: string; session: SessionInfo; now: number },
): { windows: SessionWindow[]; windowId: string } {
  const { session, now } = options;
  const existing = findWindowBySessionId(windows, session.id);
  if (existing) {
    return {
      windowId: existing.windowId,
      windows: windows.map((window) => (
        window.windowId === existing.windowId
          ? { ...window, session, cwd: session.cwd ?? window.cwd, lastActiveAt: now }
          : window
      )),
    };
  }
  const window: SessionWindow = {
    windowId: options.windowId,
    sessionId: session.id,
    draftKey: session.id,
    session,
    cwd: session.cwd ?? null,
    lastActiveAt: now,
    busy: false,
  };
  return { windows: [...windows, window], windowId: window.windowId };
}

/**
 * Opens (or re-focuses) a fresh composer window.
 *
 * A cwd only ever has one draft window: clicking "new session" again in the same
 * project should return to the composer the user already started instead of
 * accumulating one draft window per click.
 */
export function openDraftWindow(
  windows: readonly SessionWindow[],
  options: { windowId: string; draftKey: string; cwd: string; now: number },
): { windows: SessionWindow[]; windowId: string } {
  const { draftKey, cwd, now } = options;
  const existing = findWindowByDraftKey(windows, draftKey)
    ?? windows.find((window) => isDraftWindow(window) && window.cwd === cwd)
    ?? null;
  if (existing) {
    return {
      windowId: existing.windowId,
      windows: windows.map((window) => (
        window.windowId === existing.windowId
          ? { ...window, draftKey, cwd, lastActiveAt: now }
          : window
      )),
    };
  }
  const window: SessionWindow = {
    windowId: options.windowId,
    sessionId: null,
    draftKey,
    session: null,
    cwd,
    lastActiveAt: now,
    busy: false,
  };
  return { windows: [...windows, window], windowId: window.windowId };
}

export function activateWindow(
  windows: readonly SessionWindow[],
  windowId: string,
  now: number,
): SessionWindow[] {
  return windows.map((window) => (
    window.windowId === windowId ? { ...window, lastActiveAt: now } : window
  ));
}

/** Applies fresh metadata (hydration, rename, project info) to one window. */
export function updateWindow(
  windows: readonly SessionWindow[],
  windowId: string,
  patch: Partial<Pick<SessionWindow, "session" | "cwd" | "busy" | "sessionId">>,
): SessionWindow[] {
  return windows.map((window) => (
    window.windowId === windowId ? { ...window, ...patch } : window
  ));
}

/**
 * Records the window's interaction state. A window that stops interacting
 * restarts its idle countdown, so a long run finishing right before a sweep
 * does not make the window immediately evictable.
 */
export function setWindowBusy(
  windows: readonly SessionWindow[],
  windowId: string,
  busy: boolean,
  now: number,
): SessionWindow[] {
  return windows.map((window) => {
    if (window.windowId !== windowId) return window;
    if (!busy && window.busy) return { ...window, busy, lastActiveAt: now };
    return { ...window, busy };
  });
}

export function removeWindow(
  windows: readonly SessionWindow[],
  windowId: string,
): SessionWindow[] {
  return windows.filter((window) => window.windowId !== windowId);
}

export function removeWindowBySessionId(
  windows: readonly SessionWindow[],
  sessionId: string,
): SessionWindow[] {
  return windows.filter((window) => window.sessionId !== sessionId);
}

/**
 * Promotes a draft window into the persistent session it just created. The
 * `windowId` is deliberately preserved: React must keep the same instance so
 * the in-flight stream is not thrown away.
 */
export function promoteWindow(
  windows: readonly SessionWindow[],
  windowId: string,
  options: { session: SessionInfo; now: number },
): SessionWindow[] {
  const { session, now } = options;
  const promoted = windows.map((window) => (
    window.windowId === windowId
      ? {
        ...window,
        sessionId: session.id,
        draftKey: session.id,
        session,
        cwd: session.cwd ?? window.cwd,
        lastActiveAt: now,
      }
      : window
  ));
  // A window for that session may already exist (opened from the sidebar while
  // the composer was still unsaved). Keep the first occurrence only.
  const seen = new Set<string>();
  return promoted.filter((window) => {
    if (window.sessionId === null) return true;
    if (seen.has(window.sessionId)) return false;
    seen.add(window.sessionId);
    return true;
  });
}

/**
 * Picks the windows to evict, oldest first.
 *
 * A session window is only evictable when it is not in front, not busy, and does
 * not hold an unsent draft. Draft windows are protected by their text too, with
 * one documented exception: the `maxDrafts` cap may evict the oldest draft
 * window, because that text lives in the draft store and survives the window
 * (see ADR-0004). Callers must therefore report interaction state through
 * `busy` and unsent text through `draftKeysWithContent`, never as `busy`.
 */
export function selectDestroyableWindowIds(
  windows: readonly SessionWindow[],
  options: SelectDestroyableOptions,
): string[] {
  const {
    now,
    activeWindowId,
    idleMs,
    maxWindows,
    maxDrafts,
    draftKeysWithContent = [],
  } = options;
  const draftsWithContent = new Set(draftKeysWithContent);
  const destroy = new Set<string>();

  const evictableSessions = windows
    .filter((window) => (
      !isDraftWindow(window)
      && window.windowId !== activeWindowId
      && !window.busy
      && !draftsWithContent.has(window.draftKey)
    ))
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);

  // 1. Idle timeout. A clock jump backwards must not evict everything at once.
  for (const window of evictableSessions) {
    if (Math.max(0, now - window.lastActiveAt) > idleMs) destroy.add(window.windowId);
  }

  // 2. Hard cap over the session windows that would survive. The front window
  //    always counts as surviving, so a busy front window can push the total
  //    above the cap rather than cause an eviction.
  const survivingSessions = windows.filter((window) => (
    !isDraftWindow(window) && !destroy.has(window.windowId)
  ));
  let overflow = survivingSessions.length - Math.max(0, maxWindows);
  for (const window of evictableSessions) {
    if (overflow <= 0) break;
    if (destroy.has(window.windowId)) continue;
    destroy.add(window.windowId);
    overflow -= 1;
  }

  // 3. Draft cap — the only place unsent text does not protect a window.
  const evictableDrafts = windows
    .filter((window) => (
      isDraftWindow(window) && window.windowId !== activeWindowId && !window.busy
    ))
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const survivingDrafts = windows.filter((window) => (
    isDraftWindow(window) && !destroy.has(window.windowId)
  ));
  let draftOverflow = survivingDrafts.length - Math.max(0, maxDrafts);
  for (const window of evictableDrafts) {
    if (draftOverflow <= 0) break;
    if (destroy.has(window.windowId)) continue;
    destroy.add(window.windowId);
    draftOverflow -= 1;
  }

  return windows
    .filter((window) => destroy.has(window.windowId))
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .map((window) => window.windowId);
}

/**
 * Resolves the idle timeout, allowing a local override so the retention policy
 * can be exercised without a 10 minute wait. Invalid overrides are ignored.
 */
export function resolveSessionWindowIdleMs(
  storage: { getItem(key: string): string | null } | null | undefined,
  fallback = SESSION_WINDOW_IDLE_MS,
): number {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(SESSION_WINDOW_IDLE_OVERRIDE_KEY);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_IDLE_OVERRIDE_MS) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}
