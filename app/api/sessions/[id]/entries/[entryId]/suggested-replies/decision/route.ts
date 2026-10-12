import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { SUBAGENT_META_TYPE } from "@/lib/subagents";
import { normalizeToolCalls } from "@/lib/normalize";
import { replyIdeasText } from "@/lib/reply-ideas-target";
import { decideReplyIdeas, replyIdeasConfig, skippedReplyIdeasDecision } from "@/lib/reply-ideas-decision";
import type { AgentMessage } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const skip = (reason: string, status = 200) => NextResponse.json(skippedReplyIdeasDecision(reason), { status });
  const config = replyIdeasConfig();
  if (!config.enabled) return skip("disabled");
  if (!config.apiKey) return skip("missing_key");
  try {
    const rpc = getRpcSession(id);
    const live = rpc?.isAlive() ? rpc : undefined;
    if (live?.isRunning()) return skip("running");
    const path = live ? null : await resolveSessionPath(id);
    if (!live && !path) return skip("session_not_found", 404);
    const entries = live ? live.inner.sessionManager.getEntries() : getSessionEntries(path!);
    if (entries.some((entry) => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE)) return skip("subagent");
    const entry = entries.find((entry) => entry.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") return skip("message_not_found", 404);
    const message = normalizeToolCalls(entry.message as unknown as AgentMessage);
    const text = replyIdeasText(message);
    if (!text) return skip("ineligible_message");
    return NextResponse.json(await decideReplyIdeas(id, entryId, text));
  } catch {
    // Speculative enhancement: manual generation remains available on failure.
    return skip("unavailable");
  }
}
