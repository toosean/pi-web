"use client";

import { useEffect, useRef, useCallback } from "react";

export type MobileView = "sidebar" | "chat" | "file";

export interface UseMobileHistoryNavigationOptions {
  isMobile: boolean;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

export interface MobileHistoryNavigationHandle {
  openMobileFile: () => void;
  closeMobileFile: () => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleMobileSidebar: () => void;
  selectMobileSession: () => void;
}

const PI_HISTORY_STATE_KEY = "__pi_mobile_view";
const PI_HISTORY_DEPTH_KEY = "__pi_mobile_depth";

interface PiHistoryState {
  [PI_HISTORY_STATE_KEY]?: MobileView;
  [PI_HISTORY_DEPTH_KEY]?: number;
  [key: string]: unknown;
}

/**
 * Manages browser history integration for mobile viewports & WebView containers:
 * 1. When in chat view, pressing browser back opens the session sidebar.
 * 2. When in file viewer, pressing back closes file viewer and returns to chat.
 * 3. When in session list (sidebar), history is at root level (depth 0).
 */
export function useMobileHistoryNavigation({
  isMobile,
  sidebarOpen,
  rightPanelOpen,
  setSidebarOpen,
  setRightPanelOpen,
}: UseMobileHistoryNavigationOptions): MobileHistoryNavigationHandle {
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  const rightPanelOpenRef = useRef(rightPanelOpen);
  rightPanelOpenRef.current = rightPanelOpen;

  const currentDepthRef = useRef<number>(0);
  const isApplyingPopstateRef = useRef<boolean>(false);
  const initializedRef = useRef<boolean>(false);

  // Initialize history stack on mobile mount / viewport switch
  useEffect(() => {
    if (!isMobile) {
      initializedRef.current = false;
      return;
    }

    if (typeof window === "undefined") return;

    const rawState = (window.history.state ?? {}) as PiHistoryState;
    const existingDepth = typeof rawState[PI_HISTORY_DEPTH_KEY] === "number"
      ? rawState[PI_HISTORY_DEPTH_KEY]
      : undefined;

    if (existingDepth === undefined || !initializedRef.current) {
      initializedRef.current = true;
      // Base layer is sidebar (depth 0)
      window.history.replaceState(
        { ...rawState, [PI_HISTORY_STATE_KEY]: "sidebar", [PI_HISTORY_DEPTH_KEY]: 0 },
        "",
      );

      // If initial UI is chat (sidebar closed, file panel closed), push chat layer (depth 1)
      if (!sidebarOpenRef.current && !rightPanelOpenRef.current) {
        window.history.pushState(
          { ...rawState, [PI_HISTORY_STATE_KEY]: "chat", [PI_HISTORY_DEPTH_KEY]: 1 },
          "",
        );
        currentDepthRef.current = 1;
      } else if (rightPanelOpenRef.current) {
        window.history.pushState(
          { ...rawState, [PI_HISTORY_STATE_KEY]: "chat", [PI_HISTORY_DEPTH_KEY]: 1 },
          "",
        );
        window.history.pushState(
          { ...rawState, [PI_HISTORY_STATE_KEY]: "file", [PI_HISTORY_DEPTH_KEY]: 2 },
          "",
        );
        currentDepthRef.current = 2;
      } else {
        currentDepthRef.current = 0;
      }
    } else {
      currentDepthRef.current = existingDepth;
    }
  }, [isMobile]);

  // Listen to popstate (standard browser & WebView back / forward navigation)
  useEffect(() => {
    if (!isMobile) return;

    const handlePopState = (event: PopStateEvent) => {
      if (!isMobileRef.current) return;

      const state = (event.state ?? {}) as PiHistoryState;
      const targetDepth = typeof state[PI_HISTORY_DEPTH_KEY] === "number"
        ? state[PI_HISTORY_DEPTH_KEY]
        : -1;

      currentDepthRef.current = Math.max(0, targetDepth);
      isApplyingPopstateRef.current = true;

      try {
        // Case 1: In file preview view
        if (rightPanelOpenRef.current) {
          setRightPanelOpen(false);
          // If back jumped straight to sidebar (depth 0), also open sidebar
          if (targetDepth === 0) {
            setSidebarOpen(true);
          }
          return;
        }

        // Case 2: In chat view (sidebar closed, file closed)
        if (!sidebarOpenRef.current && !rightPanelOpenRef.current) {
          // Going back opens sidebar
          setSidebarOpen(true);
          return;
        }

        // Case 3: In sidebar view (sidebar already open)
        // User pressed back again -> allow container default behavior (exit / previous site)
      } finally {
        queueMicrotask(() => {
          isApplyingPopstateRef.current = false;
        });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isMobile, setRightPanelOpen, setSidebarOpen]);

  const openMobileFile = useCallback(() => {
    if (!isMobileRef.current) {
      setRightPanelOpen(true);
      return;
    }
    const rawState = (window.history.state ?? {}) as PiHistoryState;
    if (currentDepthRef.current < 1) {
      window.history.pushState(
        { ...rawState, [PI_HISTORY_STATE_KEY]: "chat", [PI_HISTORY_DEPTH_KEY]: 1 },
        "",
      );
    }
    window.history.pushState(
      { ...rawState, [PI_HISTORY_STATE_KEY]: "file", [PI_HISTORY_DEPTH_KEY]: 2 },
      "",
    );
    currentDepthRef.current = 2;
    setRightPanelOpen(true);
    setSidebarOpen(false);
  }, [setRightPanelOpen, setSidebarOpen]);

  const closeMobileFile = useCallback(() => {
    if (!isMobileRef.current) {
      setRightPanelOpen(false);
      return;
    }
    if (currentDepthRef.current >= 2) {
      window.history.back();
    } else {
      setRightPanelOpen(false);
    }
  }, [setRightPanelOpen]);

  const openMobileSidebar = useCallback(() => {
    if (!isMobileRef.current) {
      setSidebarOpen(true);
      return;
    }
    if (currentDepthRef.current === 1) {
      window.history.back();
    } else {
      currentDepthRef.current = 0;
      setSidebarOpen(true);
    }
  }, [setSidebarOpen]);

  const closeMobileSidebar = useCallback(() => {
    if (!isMobileRef.current) {
      setSidebarOpen(false);
      return;
    }
    if (currentDepthRef.current === 0) {
      const rawState = (window.history.state ?? {}) as PiHistoryState;
      window.history.pushState(
        { ...rawState, [PI_HISTORY_STATE_KEY]: "chat", [PI_HISTORY_DEPTH_KEY]: 1 },
        "",
      );
      currentDepthRef.current = 1;
    }
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const selectMobileSession = useCallback(() => {
    if (!isMobileRef.current) {
      return;
    }
    closeMobileSidebar();
  }, [closeMobileSidebar, isMobileRef]);

  const toggleMobileSidebar = useCallback(() => {
    if (!isMobileRef.current) {
      setSidebarOpen((prev) => !prev);
      return;
    }
    if (sidebarOpenRef.current) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  }, [closeMobileSidebar, openMobileSidebar, setSidebarOpen]);

  return {
    openMobileFile,
    closeMobileFile,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    selectMobileSession,
  };
}
