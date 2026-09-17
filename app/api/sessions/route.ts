import { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/json-response";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  listAllSessions,
  mergeSessionLists,
  resolveSessionPath,
} from "@/lib/session-reader";
import {
  applySessionPreferences,
  clearSessionFlags,
  readSessionFlags,
} from "@/lib/session-preferences";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const persistedSessionsPromise = listAllSessions({ force });
    // Capture before awaiting: mutations during the scan still require a later refresh.
    const sessionListVersion = getSessionListVersion();
    const [persistedSessions, runtimeSessions] = await Promise.all([
      persistedSessionsPromise,
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const merged = mergeSessionLists(persistedSessions, runtimeSessions);

    // Sidebar flags are pi-web state, not session content, so they decorate the
    // file-derived catalogue *after* it is built and cached: changing a flag
    // must never invalidate `listAllSessions()` or the per-file metadata cache.
    const flags = readSessionFlags();
    const sessions = applySessionPreferences(merged, flags);

    // Sessions removed outside pi-web (the pi TUI, or a manual `rm`) would
    // otherwise keep their flags forever. Only drop an id that is missing from
    // the catalogue *and* still unresolvable: a transient file read failure must
    // never erase a user's pins.
    await pruneUnresolvableFlags(flags, new Set(merged.map((session) => session.id)));

    return jsonResponse(
      req,
      {
        sessions,
        sessionListVersion,
        runningSessionIds: getRunningRpcSessionIds(),
        completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
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

async function pruneUnresolvableFlags(
  flags: ReadonlyMap<string, unknown>,
  knownSessionIds: ReadonlySet<string>,
): Promise<void> {
  const candidates = [...flags.keys()].filter((id) => !knownSessionIds.has(id));
  if (candidates.length === 0) return;
  const orphans: string[] = [];
  for (const id of candidates) {
    if (!(await resolveSessionPath(id))) orphans.push(id);
  }
  if (orphans.length > 0) clearSessionFlags(orphans);
}
