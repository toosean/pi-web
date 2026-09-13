/**
 * The part of `GET /api/sessions/[id]` that is derived purely from the session
 * file: message tail, tree, stats and the metadata that feeds `info`.
 *
 * Split out of the route so `lib/session-payload-cache.ts` can cache it keyed on
 * the file's identity, and so the pieces stay independently typed instead of
 * being smuggled through an untyped cache entry.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildSessionContext } from "./session-reader";
import { computeSessionTotalActiveMs } from "./session-timing";
import { computeSessionStats } from "./session-stats";
import { projectTreeForResponse } from "./project-tree";
import { readSubagentRun, readSubagentSessionResources, type SubagentRunInfo } from "./subagents";
import { readSessionToolSelection } from "./session-tool-selection";
import type { SessionContext, SessionEntry, SessionHeader, SessionTreeNode } from "./types";
import type { SessionFileStats } from "./session-stats";

export interface SessionDerivedPayload {
  filePath: string;
  header: SessionHeader | null;
  sessionName: string | undefined;
  firstUserMessage: { content: unknown } | null;
  leafId: string | null;
  tree: SessionTreeNode[];
  context: SessionContext;
  stats: SessionFileStats;
  totalActiveMs: number;
  subagent: SubagentRunInfo | null;
  toolNames: string[] | undefined;
}

export interface BuildSessionDerivedOptions {
  deferThinking: boolean;
  deferToolResultImages: boolean;
  tail: number;
  alignToTurn: boolean;
}

export function buildSessionDerivedPayload(
  id: string,
  manager: SessionManager,
  options: BuildSessionDerivedOptions,
): SessionDerivedPayload {
  const entries = manager.getEntries();
  const leafId = manager.getLeafId();
  const header = manager.getHeader();
  const filePath = manager.getSessionFile() ?? "";
  const firstUserEntry = entries.find(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );

  return {
    filePath,
    header,
    sessionName: manager.getSessionName(),
    firstUserMessage: firstUserEntry?.type === "message"
      ? { content: (firstUserEntry.message as { content: unknown }).content }
      : null,
    leafId,
    tree: projectTreeForResponse(manager.getTree()) as unknown as SessionTreeNode[],
    context: buildSessionContext(entries as never, leafId, {
      deferThinking: options.deferThinking,
      deferToolResultImages: options.deferToolResultImages,
      tail: options.tail,
      alignToTurn: options.alignToTurn,
      sessionId: id, // local: lazy URLs for historical tool-result images
    }),
    stats: computeSessionStats(entries as unknown as SessionEntry[]),
    totalActiveMs: computeSessionTotalActiveMs(entries),
    subagent: header ? readSubagentRun(entries as never, header.id, filePath) : null,
    toolNames: readSubagentSessionResources(entries as never)?.tools
      ?? readSessionToolSelection(entries as never),
  };
}
