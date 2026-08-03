"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const { t: translate } = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash before client check
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Check if running as standalone PWA
    const checkStandalone = () => {
      const isStandaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
      const isIosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      return isStandaloneMedia || isIosStandalone;
    };

    if (checkStandalone()) {
      setIsStandalone(true);
      return;
    }

    // Check if dismissed recently (e.g., within 7 days)
    const lastDismissed = localStorage.getItem("pi-pwa-install-dismissed");
    if (lastDismissed) {
      const dismissedTime = parseInt(lastDismissed, 10);
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } else {
      setDismissed(false);
    }

    // Detect iOS
    const ua = window.navigator.userAgent;
    const isIosDevice = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIos(isIosDevice);

    // Capture beforeinstallprompt for Android / Chrome / Edge / Desktop
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (isIos) {
      setShowIosGuide(true);
      return;
    }

    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setDismissed(true);
    }
  }, [deferredPrompt, isIos]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setShowIosGuide(false);
    localStorage.setItem("pi-pwa-install-dismissed", Date.now().toString());
  }, []);

  // Do not display if already standalone or user dismissed and no active trigger
  if (isStandalone || dismissed) {
    return null;
  }

  // Show if either iOS or deferredPrompt is ready
  if (!deferredPrompt && !isIos) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "max(16px, env(safe-area-inset-bottom))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        width: "calc(100% - 32px)",
        maxWidth: "420px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "12px 14px",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.25)",
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        animation: "pwa-prompt-slide-up 0.3s ease-out",
      }}
    >
      <style>{`
        @keyframes pwa-prompt-slide-up {
          from {
            opacity: 0;
            transform: translate(-50%, 20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <img
          src="/icons/icon-192.png"
          alt="Pi Web Icon"
          style={{ width: "40px", height: "40px", borderRadius: "10px", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
            {translate("pwa.installTitle") || "安装 Pi Web 应用"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
            {isIos
              ? (translate("pwa.installDescIos") || "添加到主屏幕，获得全屏独立应用体验")
              : (translate("pwa.installDesc") || "安装独立 App，体验更快更流畅")}
          </div>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            padding: "4px",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="关闭"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {showIosGuide ? (
        <div
          style={{
            marginTop: "4px",
            padding: "8px 10px",
            background: "var(--bg-subtle)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--text-muted)",
            lineHeight: 1.5,
            border: "1px solid var(--border)",
          }}
        >
          <div>
            1. 点击 Safari 底部工具栏的 <strong>“分享”</strong> 按钮
            <span style={{ margin: "0 4px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", verticalAlign: "middle" }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </span>
          </div>
          <div>2. 向下滑动，选择 <strong>“添加到主屏幕”</strong></div>
          <div>3. 点击右上角 <strong>“添加”</strong> 即可完成</div>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
          <button
            onClick={handleDismiss}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {translate("common.cancel") || "暂不安装"}
          </button>
          <button
            onClick={handleInstallClick}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              background: "var(--accent)",
              color: "#ffffff",
              fontWeight: 500,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {isIos ? (translate("pwa.howToInstall") || "查看添加指引") : (translate("pwa.install") || "立即安装")}
          </button>
        </div>
      )}
    </div>
  );
}
