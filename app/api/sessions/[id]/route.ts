import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import {
  invalidateSessionPayloadCache,
  readSessionPayloadCache,
  writeSessionPayloadCache,
  type SessionFileIdentity,
} from "@/lib/session-payload-cache";
import { buildSessionDerivedPayload, type SessionDerivedPayload } from "@/lib/session-derived";
import { clearSessionFlags } from "@/lib/session-preferences";
import { abortSubagent, getRpcSession, getRpcSessionInfos } from "@/lib/rpc-manager";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { jsonResponse } from "@/lib/json-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const alignToTurn = searchParams.get("alignToTurn") !== "0";

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
    const cacheParams = [tail, alignToTurn ? "t" : "f", deferThinking ? "t" : "f", deferToolResultImages ? "t" : "f"].join("|");
    let derived = identity
      ? readSessionPayloadCache<SessionDerivedPayload>(identity, cacheParams)
      : null;

    if (!derived) {
      const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
      derived = buildSessionDerivedPayload(id, sm, {
        deferThinking,
        deferToolResultImages,
        tail,
        alignToTurn,
      });
      if (liveRpc) {
        // A live wrapper may report a session file that has not been flushed
        // yet; the response still uses the manager's own path.
        derived.filePath = liveRpc.sessionFile || derived.filePath;
      }
      // Only the read-only path is cacheable (see above).
      if (identity) writeSessionPayloadCache(identity, cacheParams, derived);
    }

    const { filePath, header, sessionName, firstUserMessage, leafId, tree, context, stats, totalActiveMs, subagent, toolNames } = derived;
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
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: liveRpc?.isRunning() ? "running" as const : subagent.status } }
        : header.parentSession
          ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
          : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
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
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    // Deleting a session also deletes every persisted or live subagent below it.
    const sessions = mergeSessionLists(
      await listAllSessions({ force: true }),
      getRpcSessionInfos({ includeTransient: true }),
    );
    const childrenByParent = new Map<string, string[]>();
    for (const session of sessions) {
      if (session.relation?.kind !== "subagent") continue;
      const children = childrenByParent.get(session.relation.parentSessionId) ?? [];
      children.push(session.id);
      childrenByParent.set(session.relation.parentSessionId, children);
    }
    const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
    // Include local files even when the global catalogue is stale or incomplete.
    try {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        const childPath = join(dir, file);
        if (sessionPathKey(childPath) === targetPathKey) continue;
        try {
          const lines = readFileSync(childPath, "utf8").split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; id?: string };
          if (header.type !== "session" || typeof header.id !== "string") continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          const subagent = readSubagentRun(entries, header.id, childPath);
          if (!subagent) continue;
          const children = childrenByParent.get(subagent.parentSessionId) ?? [];
          children.push(header.id);
          childrenByParent.set(subagent.parentSessionId, children);
          sessionPaths.set(header.id, childPath);
        } catch { /* skip malformed or concurrently removed sessions */ }
      }
    } catch { /* skip if dir unreadable */ }
    const deletedSessionIds = new Set<string>([id]);
    const pending = [id];
    while (pending.length > 0) {
      const parentId = pending.pop()!;
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (deletedSessionIds.has(childId)) continue;
        deletedSessionIds.add(childId);
        pending.push(childId);
      }
    }
    const deletedPaths = new Map<string, string>([[id, filePath]]);
    for (const deletedId of deletedSessionIds) {
      const sessionPath = sessionPaths.get(deletedId);
      if (sessionPath) deletedPaths.set(deletedId, sessionPath);
    }
    for (const deletedId of deletedSessionIds) {
      if (deletedPaths.has(deletedId)) continue;
      const runtimePath = getRpcSession(deletedId)?.sessionFile;
      if (runtimePath) deletedPaths.set(deletedId, runtimePath);
      else {
        const resolvedPath = await resolveSessionPath(deletedId);
        if (resolvedPath) deletedPaths.set(deletedId, resolvedPath);
      }
    }
    const deletedPathKeys = new Set([...deletedPaths.values()].map((path) => sessionPathKey(path)));

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        if (deletedPathKeys.has(sessionPathKey(childPath))) continue;
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (
            header.type === "session" &&
            header.parentSession &&
            sessionPathKey(header.parentSession) === targetPathKey
          ) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            if (parentSessionPath && parentSessionId) {
              for (let index = 1; index < lines.length; index += 1) {
                let entry: { type?: string; customType?: string; data?: unknown };
                try {
                  entry = JSON.parse(lines[index]);
                } catch {
                  continue;
                }
                if (
                  entry.type !== "custom"
                  || entry.customType !== SUBAGENT_META_TYPE
                  || typeof entry.data !== "object"
                  || entry.data === null
                  || Array.isArray(entry.data)
                ) continue;
                entry.data = {
                  ...entry.data,
                  parentSessionId,
                  parentSessionPath,
                };
                lines[index] = JSON.stringify(entry);
                break;
              }
            }
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    for (const deletedId of [...deletedSessionIds].reverse()) {
      if (deletedId === id) continue;
      try { await abortSubagent(deletedId); } catch { /* idle or completed */ }
      await getRpcSession(deletedId)?.shutdown();
    }
    try { await abortSubagent(id); } catch { /* ordinary session */ }
    await getRpcSession(id)?.shutdown();
    for (const [deletedId, deletedPath] of deletedPaths) {
      try {
        unlinkSync(deletedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      invalidateSessionPayloadCache(deletedPath);
      invalidateSessionPathCache(deletedId);
    }
    // Sidebar flags are keyed by session id, so descendants must be removed too.
    clearSessionFlags(deletedSessionIds);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
