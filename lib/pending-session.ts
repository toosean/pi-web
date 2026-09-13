import type { SessionInfo } from "./types";

/**
 * Merge sessions this client created with the server session catalog.
 *
 * A new session exists only in memory until pi flushes its first JSONL (which
 * waits for the first assistant message), and the sidebar list comes from a
 * full catalog scan that re-reads every session file. Rendering the client's
 * own snapshots immediately keeps new rows visible instead of making the user
 * wait for the scan to confirm them.
 *
 * Snapshots are keyed by id and stay listed independently of which session is
 * selected, so moving the chat to another session cannot retract a row the
 * client already knows about. The server catalog stays authoritative: as soon
 * as it contains an id, the persisted record replaces the snapshot.
 */
export function mergePendingSessions(
  sessions: SessionInfo[],
  pending: readonly SessionInfo[] | null | undefined,
): SessionInfo[] {
  if (!pending || pending.length === 0) return sessions;
  const known = new Set(sessions.map((session) => session.id));
  const extras: SessionInfo[] = [];
  for (const session of pending) {
    if (known.has(session.id)) continue;
    known.add(session.id);
    extras.push(session);
  }
  return extras.length > 0 ? [...extras, ...sessions] : sessions;
}

/**
 * Remember the newest snapshot per session id, keeping the most recent
 * `MAX_PENDING` ids. Holding onto the snapshot after the user selects another
 * session is the point: the row represents "this client created this session
 * and the catalog has not caught up yet", not "this session is in front".
 */
export const MAX_PENDING_SESSIONS = 8;

export function rememberPendingSession(
  pending: readonly SessionInfo[],
  session: SessionInfo,
): SessionInfo[] {
  const next = pending.filter((entry) => entry.id !== session.id);
  next.push(session);
  return next.length > MAX_PENDING_SESSIONS
    ? next.slice(next.length - MAX_PENDING_SESSIONS)
    : next;
}

/** Drop snapshots the catalog now reports (or that were deleted server-side). */
export function prunePendingSessions(
  pending: readonly SessionInfo[],
  catalog: readonly SessionInfo[],
): SessionInfo[] {
  if (pending.length === 0 || catalog.length === 0) return pending as SessionInfo[];
  const listed = new Set(catalog.map((session) => session.id));
  const next = pending.filter((session) => !listed.has(session.id));
  return next.length === pending.length ? (pending as SessionInfo[]) : next;
}
