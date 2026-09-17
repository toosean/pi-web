import { NextResponse } from "next/server";
import {
  buildSessionContext,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { generateSuggestedReplies } from "@/lib/suggested-replies";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;

  try {
    const existing = getRpcSession(id);
    const liveSession = existing?.isAlive() ? existing : undefined;
    const filePath = liveSession ? null : await resolveSessionPath(id);
    if (!liveSession && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const session = liveSession ?? (await startRpcSession(id, filePath!, undefined)).session;
    await session.waitUntilReady?.();

    const manager = session.inner.sessionManager;
    const entry = manager.getEntry(entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
      return NextResponse.json({ error: "Assistant message not found" }, { status: 404 });
    }

    const context = buildSessionContext(manager.getEntries(), entryId);
    const result = await generateSuggestedReplies(
      session.inner as unknown as AgentSession,
      context.messages,
    );

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while suggested replies were being generated. Please try again." },
        { status: 409 },
      );
    }

    return NextResponse.json({ suggestions: result.suggestions, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
