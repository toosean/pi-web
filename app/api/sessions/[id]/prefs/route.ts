import { NextResponse } from "next/server";
import {
  parseSessionFlagPatch,
  writeSessionFlagPatch,
} from "@/lib/session-preferences";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * PUT /api/sessions/[id]/prefs — persist sidebar flags for one session.
 *
 * Body: `{ pinned?: boolean, hidden?: boolean, unread?: boolean }` (at least one).
 * Idempotent: writing the same value is a no-op for the caller.
 *
 * These flags are read back through `GET /api/sessions`, which decorates the
 * cached session catalogue from the same state file. Nothing here invalidates
 * the session-list or file-metadata caches — the flags are not file-derived.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const patch = parseSessionFlagPatch(body);
    if (!patch) {
      return NextResponse.json(
        { error: "Expected { pinned?: boolean, hidden?: boolean, unread?: boolean }" },
        { status: 400 },
      );
    }

    // A live wrapper covers sessions whose `.jsonl` does not exist yet; the file
    // lookup covers everything else. Storing flags for an unknown id would just
    // create an entry that can never be displayed.
    const known = Boolean(getRpcSession(id)?.isAlive()) || Boolean(await resolveSessionPath(id));
    if (!known) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const flags = writeSessionFlagPatch(id, patch);
    return NextResponse.json({ ok: true, id, flags });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
