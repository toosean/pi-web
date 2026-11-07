import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import {
  attachSessionProjectInfo,
  openSessionManager,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionListCache,
  invalidateSessionManagerCache,
} from "@/lib/session-reader";
import { getRpcSession, renameRpcSession, subagentDisplayStatus } from "@/lib/rpc-manager";
import {
  readSessionPayloadCache,
  writeSessionPayloadCache,
  type SessionFileIdentity,
} from "@/lib/session-payload-cache";
import { buildSessionDerivedPayload, type SessionDerivedPayload } from "@/lib/session-derived";
import { startServerPerf } from "@/lib/perf";
import { jsonResponse } from "@/lib/json-response";
import { deleteSessions } from "@/lib/session-delete";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const perf = startServerPerf("GET /api/sessions/[id]");
  try {
    perf?.span("resolve");
    const rpc = getRpcSession(id);
    const searchParams = new URL(req.url).searchParams;
    const force = searchParams.get("force") === "1";

    // A live wrapper only reflects the appends pi-web itself made. When another
    // pi process (the TUI) writes the same session file, the in-memory index
    // stays stale. Only probe on ?force=1 (session mount / page refresh): two
    // processes writing one JSONL is unsupported, so post-turn reads must not
    // scan disk. Eviction is idle-only; mid-run the wrapper owns the write path.
    let liveWrapper = rpc?.isAlive() ? rpc : undefined;
    let wrapperRebuilt = false;
    if (force && liveWrapper?.evictIfDiskAhead()) {
      wrapperRebuilt = true;
      liveWrapper = undefined;
    }
    const liveRpc = liveWrapper;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const alignToTurn = searchParams.get("alignToTurn") !== "0";
    const summaryTree = searchParams.get("tree") === "summary";

    // Everything below is derived from the session file, so for a file that has
    // not changed it is served from `lib/session-payload-cache.ts` without
    // opening a SessionManager. Sessions with a live wrapper are never cached:
    // their in-memory state can change without the file changing.
    let identity: SessionFileIdentity | null = null;
    if (!liveRpc && resolvedPath) {
      try {
        const stat = statSync(resolvedPath);
        identity = {
          filePath: resolvedPath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          ctimeMs: stat.ctimeMs,
        };
      } catch {
        identity = null;
      }
    }
    const cacheParams = [
      tail,
      alignToTurn ? "t" : "f",
      deferThinking ? "t" : "f",
      deferToolResultImages ? "t" : "f",
      summaryTree ? "t" : "f",
    ].join("|");
    let derived = identity
      ? readSessionPayloadCache<SessionDerivedPayload>(identity, cacheParams)
      : null;

    if (!derived) {
      const sm = liveRpc?.inner.sessionManager ?? openSessionManager(resolvedPath!);
      perf?.span("open");
      derived = buildSessionDerivedPayload(id, sm, {
        deferThinking,
        deferToolResultImages,
        tail,
        alignToTurn,
        summaryTree,
        sourceId: liveRpc ? `runtime:${String(liveRpc.inner.sessionId)}` : "disk",
        models: liveRpc?.inner.modelRuntime,
      });
      if (liveRpc) {
        // A live wrapper may report a session file that has not been flushed
        // yet; the response still uses the manager's own path.
        derived.filePath = liveRpc.sessionFile || derived.filePath;
      }
      // Only the read-only path is cacheable (see above).
      if (identity) writeSessionPayloadCache(identity, cacheParams, derived);
    }

    const { filePath, header, sessionName, firstUserMessage, leafId, tree, snapshotRevision, context, stats, totalActiveMs, subagent, side, toolNames } = derived;
    let modified = header?.timestamp ?? new Date().toISOString();
    try {
      if (filePath && existsSync(filePath)) {
        modified = new Date(statSync(filePath).mtimeMs).toISOString();
      }
    } catch {
      // Keep header timestamp fallback
    }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? (await attachSessionProjectInfo([{
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sessionName,
      created: header.timestamp,
      modified,
      messageCount: stats.totalMessages,
      firstMessage: firstUserMessage
        ? (() => {
            const c = firstUserMessage.content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      ...(subagent
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: subagentDisplayStatus(header.id, liveRpc?.isRunning() ? "running" as const : subagent.status) } }
        : side
          ? { relation: { kind: "side" as const, ...side } }
          : header.parentSession
            ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
            : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return perf?.attach(jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    )) ?? jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    const trimmed = name.trim();
    // A session a wrapper holds is renamed in it, never on disk behind its back (#1388).
    const renamed = await renameRpcSession(id, trimmed, () => {
      if (!filePath) return false;
      // No wrapper: appendSessionInfo on a fresh manager, bypassing the cache.
      const sm = openSessionManager(filePath, { mutable: true });
      sm.appendSessionInfo(trimmed);
      invalidateSessionManagerCache(filePath);
      invalidateSessionListCache();
      return true;
    });
    if (!renamed) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id] - the session and the subagent sessions below it (lib/session-delete.ts).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { missing } = await deleteSessions([id]);
    if (missing.length > 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
