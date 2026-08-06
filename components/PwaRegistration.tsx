"use client";

import { useEffect } from "react";

function isPiWebServiceWorker(registration: ServiceWorkerRegistration): boolean {
  const scriptUrl = registration.active?.scriptURL
    ?? registration.waiting?.scriptURL
    ?? registration.installing?.scriptURL;
  if (!scriptUrl) return false;

  try {
    const url = new URL(scriptUrl);
    return url.origin === window.location.origin && url.pathname === "/sw.js";
  } catch {
    return false;
  }
}

async function cleanupDevelopmentPwa() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const piWebRegistrations = registrations.filter(isPiWebServiceWorker);

  await Promise.all(piWebRegistrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("pi-web-"))
        .map((name) => window.caches.delete(name)),
    );
  }

  if (piWebRegistrations.length > 0 && navigator.serviceWorker.controller) {
    window.location.reload();
  }
}

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void cleanupDevelopmentPwa().catch((error: unknown) => {
        console.error("Failed to clean up the Pi Web development service worker:", error);
      });
      return;
    }

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
