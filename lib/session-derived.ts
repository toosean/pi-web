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
import { projectTreeForResponse, toSummaryTree } from "./project-tree";
import { computeSessionRevision } from "./session-revision";
import { readSubagentRun, readSubagentSessionResources, type SubagentRunInfo } from "./subagents";
import { readSideRelation, sideOwnEntries } from "./side-session";
import { attachTranscriptNotices, readSessionTranscriptNotices } from "./transcript-notices-server";
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
  /** Opaque freshness token for the session view cache (`lib/session-revision.ts`). */
  snapshotRevision: string | null;
  context: SessionContext;
  stats: SessionFileStats;
  totalActiveMs: number;
  subagent: SubagentRunInfo | null;
  /** A side chat's relation to the session it was forked from (#1469). */
  side: { parentSessionId: string } | null;
  toolNames: string[] | undefined;
}

export interface BuildSessionDerivedOptions {
  deferThinking: boolean;
  deferToolResultImages: boolean;
  tail: number;
  alignToTurn: boolean;
  /** Serve the sidebar's collapsed tree instead of the full one. */
  summaryTree?: boolean;
  /** `runtime:<id>` while a live wrapper reads the session, `disk` otherwise. */
  sourceId?: string;
  /** The live wrapper's model runtime; transcript notices need it while it runs. */
  models?: unknown;
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
  const fullTree = projectTreeForResponse(manager.getTree());
  const latestEntry = entries[entries.length - 1] as { id?: string } | undefined;
  // pi's showCacheMissNotices (#1265): cache, cost and provider notices on the messages they follow.
  const transcriptNotices = readSessionTranscriptNotices({
    entries: entries as unknown as SessionEntry[],
    cwd: header?.cwd ?? "",
    leafId,
    models: options.models as never,
  });
  const snapshotRevision = computeSessionRevision({
    filePath,
    // The notices switch changes the messages without touching the file.
    sourceId: `${options.sourceId ?? "disk"}${transcriptNotices ? "+notices" : ""}`,
    entryCount: entries.length,
    latestEntryId: typeof latestEntry?.id === "string" ? latestEntry.id : null,
    leafId: leafId ?? null,
  });

  const subagent = header ? readSubagentRun(entries as never, header.id, filePath) : null;

  return {
    filePath,
    header,
    sessionName: manager.getSessionName(),
    firstUserMessage: firstUserEntry?.type === "message"
      ? { content: (firstUserEntry.message as { content: unknown }).content }
      : null,
    leafId,
    tree: (options.summaryTree ? toSummaryTree(fullTree) : fullTree) as unknown as SessionTreeNode[],
    snapshotRevision,
    context: attachTranscriptNotices(buildSessionContext(entries as never, leafId, {
      deferThinking: options.deferThinking,
      deferToolResultImages: options.deferToolResultImages,
      tail: options.tail,
      alignToTurn: options.alignToTurn,
      sessionId: id, // local: lazy URLs for historical tool-result images
    }), transcriptNotices),
    // A side chat's own entries only: the parent's transcript is not its usage.
    stats: computeSessionStats(sideOwnEntries(entries) as unknown as SessionEntry[]),
    totalActiveMs: computeSessionTotalActiveMs(sideOwnEntries(entries)),
    subagent,
    side: header && !subagent ? readSideRelation(entries as never) : null,
    toolNames: readSubagentSessionResources(entries as never)?.tools
      ?? readSessionToolSelection(entries as never),
  };
}
