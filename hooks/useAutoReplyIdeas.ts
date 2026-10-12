"use client";

import { useCallback, useEffect, useRef } from "react";
import { AutoReplyIdeas } from "@/lib/auto-reply-ideas";
import type { CompletedReplyTurn } from "@/lib/reply-ideas-target";

interface Options {
  turn: CompletedReplyTurn | null;
  sessionId: string | null;
  leafId: string | null;
  latestEntryId: string | null;
  active: boolean;
  busy: boolean;
  onOpen: (turn: CompletedReplyTurn, probability: number) => void;
}

export function useAutoReplyIdeas(options: Options) {
  const controller = useRef(new AutoReplyIdeas());
  const current = useRef(options);
  current.current = options;
  const { turn, sessionId, leafId, latestEntryId, active, busy } = options;

  useEffect(() => {
    const instance = controller.current;
    if (!turn || !active || busy) return;
    const canOpen = () => {
      const value = current.current;
      return document.visibilityState === "visible" && value.active && !value.busy
        && value.sessionId === turn.sessionId && value.leafId === turn.leafId
        && value.latestEntryId === turn.entryId;
    };
    void instance.consider(turn, canOpen, (probability) => current.current.onOpen(turn, probability));
    return () => instance.cancel();
  }, [turn, sessionId, leafId, latestEntryId, active, busy]);

  useEffect(() => {
    const instance = controller.current;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") instance.cancel();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      instance.cancel();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return useCallback((target?: { sessionId: string; entryId: string }) => {
    controller.current.suppress(target);
    // Interacting with an older panel also takes precedence over this turn.
    if (current.current.turn) controller.current.suppress(current.current.turn);
  }, []);
}
