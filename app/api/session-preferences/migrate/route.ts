import { NextResponse } from "next/server";
import {
  mergeSessionFlags,
  parseSessionFlagIdLists,
  readSessionFlags,
} from "@/lib/session-preferences";
import {
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import { getRpcSessionInfos } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * POST /api/session-preferences/migrate — one-shot import of the flags a browser
 * used to keep in `localStorage` (`pi-web:pinned-session-ids`, `-hidden-`, `-unread-`).
 *
 * Body: `{ pinned?: string[], hidden?: string[], unread?: string[] }`.
 * The operation is a union, never a replace: a second browser migrating its own
 * list cannot clear flags the server already holds, and ids that no longer
 * resolve to a session are skipped.
 */
export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const lists = parseSessionFlagIdLists(body);
    if (!lists) {
      return NextResponse.json(
        { error: "Expected { pinned?: string[], hidden?: string[], unread?: string[] }" },
        { status: 400 },
      );
    }

    const sessions = mergeSessionLists(await listAllSessions(), getRpcSessionInfos());
    const allowedIds = new Set(sessions.map((session) => session.id));
    const { applied, skipped } = mergeSessionFlags(lists, allowedIds);

    return NextResponse.json(
      {
        ok: true,
        applied,
        skipped,
        stored: readSessionFlags().size,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
