"use client";

import { useEffect } from "react";

/**
 * App Badging API integration.
 *
 * Subscribes to the running-session SSE stream and updates the installed PWA's icon badge
 * (e.g. the macOS Dock / Windows taskbar / Android launcher badge).
 *
 * Badge behavior:
 *   - When an agent session finishes (running count decreases) and the page is hidden,
 *     a badge is set to alert the user that a task has completed.
 *   - When the user opens or switches back to the page (visibility becomes "visible"),
 *     the badge is automatically cleared.
 */
export function PwaBadge() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) {
      return;
    }
    // Only relevant for installed (standalone) PWAs, but harmless otherwise.
    if (!("serviceWorker" in navigator)) return;

    let es: EventSource | null = null;
    let stopped = false;
    let prevRunningCount: number | null = null;
    let unreadFinishedCount = 0;

    const applyBadge = (count: number) => {
      try {
        if (count > 0) {
          void (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(count);
        } else {
          void (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
        }
      } catch {
        // Badging is best-effort; ignore failures.
      }
    };

    const clearBadge = () => {
      unreadFinishedCount = 0;
      applyBadge(0);
    };

    const handleRunningCount = (runningCount: number) => {
      if (prevRunningCount !== null && runningCount < prevRunningCount) {
        // One or more agent sessions finished running
        const finishedDiff = prevRunningCount - runningCount;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
          unreadFinishedCount += finishedDiff;
          applyBadge(unreadFinishedCount);
        }
      }
      prevRunningCount = runningCount;

      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        clearBadge();
      }
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/agent/running/events");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string; runningSessionIds?: string[] };
          if (data.type === "running" && Array.isArray(data.runningSessionIds)) {
            handleRunningCount(data.runningSessionIds.length);
          }
        } catch {
          // Ignore malformed frames (heartbeats are comment-only).
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do here.
      };
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        clearBadge();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    // Initial probe to set up baseline running count.
    fetch("/api/agent/running", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { runningSessionIds?: string[] } | null) => {
        if (stopped) return;
        const count = data?.runningSessionIds?.length ?? 0;
        prevRunningCount = count;
        if (document.visibilityState === "visible") {
          clearBadge();
        }
      })
      .catch(() => { /* keep whatever badge state exists */ });

    connect();

    return () => {
      stopped = true;
      es?.close();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, []);

  return null;
}
