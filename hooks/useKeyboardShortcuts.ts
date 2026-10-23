"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
//
// Several ChatWindows can be mounted at once (see `lib/session-windows.ts`), so
// handlers are keyed by window id and only the window currently in front may
// answer Esc. Registering a window that is not in front is harmless: AppShell
// owns `activeAbortOwnerId`.
// ---------------------------------------------------------------------------
const abortHandlers = new Map<string, () => void>();
let activeAbortOwnerId: string | null = null;

// The upstream single-handler form registers under this reserved id. It is only
// consulted when no mounted window owns the front, which is the case in the
// tests that drive `handleGlobalEscape()` on its own.
const GLOBAL_ABORT_OWNER = "\u0000global";

/** Declares which window owns the global Esc shortcut. */
export function setAbortHandlerOwner(ownerId: string | null): void {
  activeAbortOwnerId = ownerId;
}

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever `sessionBusy` or `handleAbort` changes.
 *
 * The one-argument form registers the single global handler upstream used
 * before sessions stayed mounted.
 */
export function registerAbortHandler(ownerId: string, handler: (() => void) | null): void;
export function registerAbortHandler(handler: (() => void) | null): void;
export function registerAbortHandler(
  ownerIdOrHandler: string | (() => void) | null,
  handler?: (() => void) | null,
): void {
  const key = typeof ownerIdOrHandler === "string" ? ownerIdOrHandler : GLOBAL_ABORT_OWNER;
  const value = typeof ownerIdOrHandler === "string" ? handler ?? null : ownerIdOrHandler;
  if (value) abortHandlers.set(key, value);
  else abortHandlers.delete(key);
}

/** Drops every handler for windows that no longer exist. */
export function retainAbortHandlers(ownerIds: Iterable<string>): void {
  const keep = new Set(ownerIds);
  for (const ownerId of [...abortHandlers.keys()]) {
    if (!keep.has(ownerId)) abortHandlers.delete(ownerId);
  }
}

function currentAbortHandler(): (() => void) | null {
  if (activeAbortOwnerId) {
    const owned = abortHandlers.get(activeAbortOwnerId);
    if (owned) return owned;
  }
  return abortHandlers.get(GLOBAL_ABORT_OWNER) ?? null;
}

/**
 * The global Esc shortcut: stops the running agent, unless the key belongs to
 * something else. Typed into a textarea or input, it is that field's (ChatInput
 * has its own Esc logic). Marked handled already (`defaultPrevented`), it was
 * something nearer's: Settings, a menu or a viewer that closed on it. Those
 * listen on `document` or below and run before this one on `window`, and
 * closing them must not stop a run as well. Returns whether it stopped the
 * agent.
 */
export function handleGlobalEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;

  const abort = currentAbortHandler();
  if (!abort) return false;

  const tag = (event.target as HTMLElement | null)?.tagName;
  // Let textarea/input handle Esc internally (ChatInput menus / stop).
  if (tag === "TEXTAREA" || tag === "INPUT") return false;

  event.preventDefault();
  abort();
  return true;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component. Nor is an Esc something nearer
 * already handled (see `handleGlobalEscape()`).
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        handleGlobalEscape(e);
        return;
      }

      // ---- Ctrl+Alt+N: new session ----
      if (e.key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession]);
}
