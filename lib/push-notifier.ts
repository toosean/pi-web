import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Web Push (Push API) notifications for Pi Web.
 *
 * Enables "task finished / waiting for your input" system notifications even
 * when the Pi Web tab is closed. Requires:
 *   - HTTPS (already satisfied by the deployment reverse proxy)
 *   - VAPID keys (auto-generated on first use, persisted under ~/.pi-web/)
 *   - A user subscription registered via POST /api/push/subscribe
 *
 * The `web-push` package is imported lazily so that a missing/optional
 * dependency can never crash unrelated server code paths.
 */

interface PushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** BCP-47 locale recorded at subscribe time, used to pick notification copy. */
  locale?: string;
}

export type PushNotificationKind = "completed" | "waiting" | "custom";

export interface PushNotificationPayload {
  /** Notification kind — drives localized copy. */
  kind: PushNotificationKind;
  /** For kind === "custom": explicit title/body (still localized via `localized` if provided). */
  title?: string;
  body?: string;
  /** Optional per-locale overrides: { "zh-CN": { title, body }, "en": { ... } }. */
  localized?: Record<string, { title?: string; body?: string }>;
  sessionId?: string;
  url?: string;
  icon?: string;
}

// ---------------------------------------------------------------------------
// Storage layout: ~/.pi-web/vapid.json + ~/.pi-web/push-subscriptions.json
// ---------------------------------------------------------------------------

function getDataDir(): string {
  try {
    return join(getAgentDir(), "..", "pi-web");
  } catch {
    return join(homedir(), ".pi-web");
  }
}

function ensureDataDir(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ---------------------------------------------------------------------------
// VAPID keys
// ---------------------------------------------------------------------------

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function getVapidKeys(): VapidKeys {
  const fromEnv = process.env.PI_WEB_VAPID_PUBLIC_KEY && process.env.PI_WEB_VAPID_PRIVATE_KEY;
  if (fromEnv) {
    return {
      publicKey: process.env.PI_WEB_VAPID_PUBLIC_KEY!,
      privateKey: process.env.PI_WEB_VAPID_PRIVATE_KEY!,
    };
  }

  const file = join(ensureDataDir(), "vapid.json");
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as VapidKeys;
      if (parsed?.publicKey && parsed?.privateKey) return parsed;
    } catch {
      // Corrupt file — regenerate below.
    }
  }

  // Lazy require keeps the import off hot server paths until first use.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- web-push stays off the server hot path until a push is actually sent.
  const webpush = require("web-push") as typeof import("web-push");
  const keys = webpush.generateVAPIDKeys();
  writePrivateFileAtomicSync(file, JSON.stringify(keys, null, 2));
  return keys;
}

function getVapidSubject(): string {
  return process.env.PI_WEB_VAPID_SUBJECT || "mailto:pi-web@localhost";
}

// ---------------------------------------------------------------------------
// Localized copy
// ---------------------------------------------------------------------------

const COPY: Record<PushNotificationKind, Record<string, { title: string; body: string }>> = {
  completed: {
    "zh-CN": { title: "任务完成", body: "Pi Web 上的任务已完成，点击查看结果。" },
    "zh-TW": { title: "任務完成", body: "Pi Web 上的任務已完成，點擊查看結果。" },
    en: { title: "Task completed", body: "Your task on Pi Web has finished. Tap to view the result." },
  },
  waiting: {
    "zh-CN": { title: "等待你的输入", body: "Agent 已完成当前步骤，等待你的回复。" },
    "zh-TW": { title: "等待你的輸入", body: "Agent 已完成目前步驟，等待你的回覆。" },
    en: { title: "Waiting for your input", body: "The agent is waiting for your reply." },
  },
  custom: {
    "zh-CN": { title: "Pi Web 通知", body: "" },
    "zh-TW": { title: "Pi Web 通知", body: "" },
    en: { title: "Pi Web notification", body: "" },
  },
};

function pickLocale(locale: string | undefined): string {
  if (!locale) return "en";
  const normalized = locale.replace("_", "-");
  if (normalized.startsWith("zh-CN") || normalized === "zh-CN" || normalized === "zh" || normalized.startsWith("zh-Hans")) return "zh-CN";
  if (normalized.startsWith("zh")) return "zh-TW";
  return "en";
}

function renderCopy(
  kind: PushNotificationKind,
  locale: string | undefined,
  payload: PushNotificationPayload,
): { title: string; body: string } {
  const base = COPY[kind][pickLocale(locale)];
  const localized = payload.localized?.[pickLocale(locale)];
  if (kind === "custom") {
    return {
      title: localized?.title ?? payload.title ?? base.title,
      body: localized?.body ?? payload.body ?? base.body,
    };
  }
  return {
    title: localized?.title ?? base.title,
    body: localized?.body ?? base.body,
  };
}

// ---------------------------------------------------------------------------
// Subscription store
// ---------------------------------------------------------------------------

function getSubscriptionsFile(): string {
  return join(ensureDataDir(), "push-subscriptions.json");
}

function loadSubscriptions(): PushSubscription[] {
  const file = getSubscriptionsFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSubscriptions(subscriptions: PushSubscription[]): void {
  writePrivateFileAtomicSync(getSubscriptionsFile(), JSON.stringify(subscriptions, null, 2));
}

export function listPushSubscriptions(): PushSubscription[] {
  return loadSubscriptions();
}

export function addPushSubscription(subscription: PushSubscription): void {
  const subs = loadSubscriptions();
  const next = subs.filter((s) => s.endpoint !== subscription.endpoint);
  next.push(subscription);
  saveSubscriptions(next);
}

export function removePushSubscription(endpoint: string): void {
  const subs = loadSubscriptions();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) saveSubscriptions(next);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function webpushOrNull(): typeof import("web-push") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load so a missing/optional dep never crashes unrelated server paths.
    return require("web-push") as typeof import("web-push");
  } catch {
    return null;
  }
}

/** In-memory dedup: avoid duplicate notifications for the same session+type
 *  within a short window (agent_end is usually followed by agent_settled). */
const recentNotifications = new Map<string, { type: string; ts: number }>();
const DEDUP_WINDOW_MS = 30_000;

/** Records a notification for this session+type. Returns true if an identical
 *  notification for this session+type was already sent within the window. */
export function recordAndCheckSuppress(sessionId: string, type: string): boolean {
  const key = `session:${sessionId}`;
  const last = recentNotifications.get(key);
  const now = Date.now();
  if (last && last.type === type && now - last.ts < DEDUP_WINDOW_MS) {
    return true;
  }
  recentNotifications.set(key, { type, ts: now });
  return false;
}

/** Non-mutating check: was a notification of this type sent for this session
 *  within the window? (Used to skip agent_settled right after agent_end.) */
export function wasRecentlyNotified(sessionId: string, type: string, windowMs = DEDUP_WINDOW_MS): boolean {
  const last = recentNotifications.get(`session:${sessionId}`);
  return !!last && last.type === type && Date.now() - last.ts < windowMs;
}

/**
 * Send a push notification to every registered subscription.
 * Returns the number of successfully delivered notifications.
 */
export async function sendPushNotification(payload: PushNotificationPayload): Promise<number> {
  const subs = loadSubscriptions();
  if (subs.length === 0) return 0;

  const webpush = webpushOrNull();
  if (!webpush) return 0;

  const vapid = getVapidKeys();
  webpush.setVapidDetails(getVapidSubject(), vapid.publicKey, vapid.privateKey);

  const url = payload.url ?? (payload.sessionId ? `/?session=${encodeURIComponent(payload.sessionId)}` : "/");

  let delivered = 0;
  const staleEndpoints: string[] = [];

  await Promise.all(subs.map(async (sub) => {
    const { title, body } = renderCopy(payload.kind, sub.locale, payload);
    const data = {
      title,
      body,
      sessionId: payload.sessionId,
      url,
      icon: payload.icon ?? "/icons/icon-192.png",
    };

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, expirationTime: sub.expirationTime, keys: sub.keys },
        JSON.stringify(data),
        { TTL: 60 * 60, urgency: "high" },
      );
      delivered += 1;
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode;
      // 404/410 = subscription gone; drop it.
      if (code === 404 || code === 410) {
        staleEndpoints.push(sub.endpoint);
      } else {
        console.error("[pi-web] push send failed:", error instanceof Error ? error.message : error);
      }
    }
  }));

  if (staleEndpoints.length > 0) {
    const current = loadSubscriptions();
    const staleSet = new Set(staleEndpoints);
    const next = current.filter((s) => !staleSet.has(s.endpoint));
    if (next.length !== current.length) saveSubscriptions(next);
  }

  return delivered;
}

/** Convenience for tests / diagnostics. */
export function generateVapidKeysForTesting(): VapidKeys {
  const webpush = webpushOrNull();
  if (!webpush) throw new Error("web-push is not installed");
  return webpush.generateVAPIDKeys();
}
