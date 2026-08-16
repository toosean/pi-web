const CACHE_PREFIX = "pi-web";
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_SCHEMA = "v3";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_SCHEMA}-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { credentials: "same-origin" });
          if (response.ok) await cache.put(url, response);
        }),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Session data and live agent traffic must always come from the local server.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  // HTML page navigations use Stale-While-Revalidate for instant render while keeping content fresh
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(request, OFFLINE_URL));
    return;
  }

  // Next.js content-hashed static assets (immutable JS chunks, CSS, fonts) use Cache-First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Precached static site assets (icons, manifest, favicon, offline fallback)
  if (PRECACHE_URLS.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && (response.type === "basic" || response.type === "default")) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(request, fallbackUrl) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok && (response.type === "basic" || response.type === "default")) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(async () => {
      if (cached) return cached;
      if (fallbackUrl) {
        const fallback = await caches.match(fallbackUrl);
        if (fallback) return fallback;
      }
      return Response.error();
    });

  return cached || fetchPromise;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/";
  let targetUrl = new URL("/", self.location.origin);
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Keep the root URL when notification data is malformed.
  }

  event.waitUntil(focusOrOpenWindow(targetUrl.href));
});

async function focusOrOpenWindow(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const exactClient = windowClients.find((client) => client.url === targetUrl);
  const candidates = exactClient
    ? [exactClient, ...windowClients.filter((client) => client !== exactClient)]
    : windowClients;

  for (const client of candidates) {
    try {
      const targetClient = client.url === targetUrl
        ? client
        : (await client.navigate(targetUrl)) ?? client;
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}

// ---------------------------------------------------------------------------
// Web Push notifications
// ---------------------------------------------------------------------------

// Suppress the notification when a focused Pi Web window is already showing
// the session the push refers to (the user is watching it live).
async function shouldSkipForFocusedClient(data) {
  if (!data || !data.sessionId) return false;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if (!client.focused) continue;
    try {
      const clientUrl = new URL(client.url);
      if (clientUrl.searchParams.get("session") === data.sessionId) return true;
    } catch {
      // ignore malformed client URL
    }
  }
  return false;
}

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? JSON.parse(event.data.text()) : null;
  } catch {
    // Non-JSON payload; fall through with null.
  }

  const title = (data && data.title) || "Pi Web";
  const options = {
    body: (data && data.body) || "",
    icon: (data && data.icon) || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: (data && data.url) || "/",
      sessionId: data && data.sessionId,
      timestamp: Date.now(),
    },
    tag: data && data.sessionId ? `pi-web-session-${data.sessionId}` : `pi-web-${Date.now()}`,
    renotify: true,
  };

  event.waitUntil(
    shouldSkipForFocusedClient(data).then((skip) => {
      if (skip) return;
      return self.registration.showNotification(title, options);
    }),
  );
});
