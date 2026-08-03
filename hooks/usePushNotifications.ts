"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PushNotificationState {
  /** Whether the browser supports the Push API + service workers. */
  supported: boolean;
  /** Notification permission status: "default" | "granted" | "denied". */
  permission: NotificationPermission | "unsupported";
  /** Whether we currently have an active push subscription registered. */
  subscribed: boolean;
  /** True while an async subscribe/unsubscribe operation is in flight. */
  busy: boolean;
  /** Request permission and subscribe. Must be called from a user gesture. */
  enable: () => Promise<void>;
  /** Unsubscribe and remove the server-side registration. */
  disable: () => Promise<void>;
}

/**
 * Web Push subscription lifecycle for Pi Web.
 *
 * - Reads the VAPID public key from the server, builds a subscription via
 *   `pushManager.subscribe`, and registers it with POST /api/push/subscribe.
 * - `enable()` must be triggered by a user gesture (Notification permission
 *   rules); wire it to a button click.
 * - The subscribed state is derived from `pushManager.getSubscription()`, so
 *   it survives page reloads without extra server state.
 */
export function usePushNotifications(): PushNotificationState {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setSupported(false);
      setPermission("unsupported");
      setSubscribed(false);
      return;
    }
    setSupported(true);
    setPermission(Notification.permission);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Re-check when the page becomes visible again (permission may have changed).
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onSubChanged = () => {
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pi-push-subscription-changed", onSubChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pi-push-subscription-changed", onSubChanged);
    };
  }, [refresh]);

  const enable = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return;
      }
      const permission = await Notification.requestPermission();
      setPermission(permission);
      if (permission !== "granted") return;

      // Fetch the VAPID public key from the server.
      const res = await fetch("/api/push/subscribe", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { vapidPublicKey } = await res.json() as { vapidPublicKey?: string };
      if (!vapidPublicKey) throw new Error("Missing VAPID public key");

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
      }

      // Register with the server, carrying the locale for localized copy.
      const locale = (typeof navigator !== "undefined" && navigator.language) || "en";
      const body = JSON.stringify({
        subscription: sub.toJSON(),
        locale,
      });
      const post = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!post.ok) throw new Error(`HTTP ${post.status}`);

      setSubscribed(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("pi-push-subscription-changed"));
      }
    } catch (error) {
      console.error("[pi-web] push subscribe failed:", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Best-effort server cleanup.
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setSubscribed(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("pi-push-subscription-changed"));
      }
    } catch (error) {
      console.error("[pi-web] push unsubscribe failed:", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { supported, permission, subscribed, busy, enable, disable };
}

/** Convert a base64url-encoded VAPID key to a Uint8Array (pushManager expects it). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
