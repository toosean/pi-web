import { NextResponse } from "next/server";
import {
  addPushSubscription,
  listPushSubscriptions,
  removePushSubscription,
  getVapidKeys,
} from "@/lib/push-notifier";

export const dynamic = "force-dynamic";

// GET /api/push/subscribe - expose the VAPID public key so the client can
// build a push subscription, plus whether a given endpoint is registered.
export async function GET(req: Request) {
  try {
    const vapid = getVapidKeys();
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");
    let registered = false;
    if (endpoint) {
      registered = listPushSubscriptions().some((s) => s.endpoint === endpoint);
    }
    return NextResponse.json({ vapidPublicKey: vapid.publicKey, registered });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/push/subscribe - register a new push subscription.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { subscription?: unknown; locale?: string };
    const subscription = body.subscription as {
      endpoint?: string;
      expirationTime?: number | null;
      keys?: { p256dh?: string; auth?: string };
    } | null;

    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
    }

    addPushSubscription({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      locale: typeof body.locale === "string" ? body.locale : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/push/subscribe - remove a push subscription.
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { endpoint?: string };
    if (!body.endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }
    removePushSubscription(body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
