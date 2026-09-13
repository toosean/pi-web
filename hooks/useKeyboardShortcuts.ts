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

/** Declares which window owns the global Esc shortcut. */
export function setAbortHandlerOwner(ownerId: string | null): void {
  activeAbortOwnerId = ownerId;
}

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever `sessionBusy` or `handleAbort` changes.
 */
export function registerAbortHandler(ownerId: string, handler: (() => void) | null): void {
  if (handler) abortHandlers.set(ownerId, handler);
  else abortHandlers.delete(ownerId);
}

/** Drops every handler for windows that no longer exist. */
export function retainAbortHandlers(ownerIds: Iterable<string>): void {
  const keep = new Set(ownerIds);
  for (const ownerId of [...abortHandlers.keys()]) {
    if (!keep.has(ownerId)) abortHandlers.delete(ownerId);
  }
}

function currentAbortHandler(): (() => void) | null {
  if (!activeAbortOwnerId) return null;
  return abortHandlers.get(activeAbortOwnerId) ?? null;
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
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        const abort = currentAbortHandler();
        if (!abort) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        abort();
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
