import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { getPiWebDataDir } from "./pi-web-data-dir";
import type { SessionFlag, SessionFlagPatch, SessionInfo } from "./types";

/**
 * Server-side persistence for the sidebar's per-session flags (pin / hide /
 * unread).
 *
 * These used to live in browser `localStorage`, which meant they were per
 * browser profile: invisible to another device, lost on a profile reset, and
 * impossible to reconcile with a second open tab. They are pi-web *UI state*,
 * not pi session content, so they are stored in pi-web's own `~/.pi-web` state
 * directory rather than as `pi-web:*` custom entries inside the session
 * `.jsonl` files — appending to a session log would leak UI state into pi's
 * data, follow forks, and show up in exported HTML.
 *
 * File shape (`~/.pi-web/session-preferences.json`):
 *
 * ```json
 * { "version": 1, "sessions": { "<session-id>": { "pinned": true } } }
 * ```
 *
 * Only set flags are stored: an absent key means "not set", so unpinning is a
 * deletion and the file stays proportional to the flags actually in use.
 *
 * Read semantics are fail-soft. A corrupt or unreadable file behaves like an
 * empty one instead of failing the session-list request the sidebar depends on
 * — the previous `localStorage` implementation swallowed the same errors.
 */

export const SESSION_FLAGS: readonly SessionFlag[] = ["pinned", "hidden", "unread"];

const PREFERENCES_VERSION = 1;
const PREFERENCES_FILE_NAME = "session-preferences.json";
/** Defensive bound; a legitimate migration payload is far smaller. */
const MAX_MIGRATION_IDS_PER_FLAG = 5000;

/** Only `true` is stored, so the type makes "flag absent" explicit. */
export type SessionFlags = Partial<Record<SessionFlag, true>>;

interface FileIdentity {
  mtimeMs: number;
  size: number;
  ctimeMs: number;
}

interface PreferencesCacheEntry {
  path: string;
  /** `null` while the file does not exist. */
  identity: FileIdentity | null;
  flags: Map<string, SessionFlags>;
}

declare global {
  var __piWebSessionPreferences: PreferencesCacheEntry | undefined;
}

export function getSessionPreferencesPath(agentDir?: string): string {
  return join(getPiWebDataDir(agentDir), PREFERENCES_FILE_NAME);
}

function readIdentity(path: string): FileIdentity | null {
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size, ctimeMs: stats.ctimeMs };
  } catch {
    return null;
  }
}

function sameIdentity(a: FileIdentity | null, b: FileIdentity | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ctimeMs === b.ctimeMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict parser: unknown flags, non-boolean values and bad versions are ignored. */
function parseSessionFlags(value: unknown): SessionFlags | undefined {
  if (!isRecord(value)) return undefined;
  const flags: SessionFlags = {};
  for (const flag of SESSION_FLAGS) {
    if (value[flag] === true) flags[flag] = true;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
}

function parsePreferences(raw: string): Map<string, SessionFlags> {
  const flags = new Map<string, SessionFlags>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return flags;
  }
  if (!isRecord(parsed)) return flags;
  if (parsed.version !== undefined && parsed.version !== PREFERENCES_VERSION) return flags;
  const sessions = parsed.sessions;
  if (!isRecord(sessions)) return flags;
  for (const [sessionId, value] of Object.entries(sessions)) {
    const parsedFlags = parseSessionFlags(value);
    if (parsedFlags) flags.set(sessionId, parsedFlags);
  }
  return flags;
}

/**
 * Every stored flag, keyed by session id.
 *
 * The whole parsed file is cached under its `(path, mtimeMs, size, ctimeMs)`
 * identity, so the common case — a sidebar refresh with no flag change — costs
 * one `stat` instead of a parse. Callers receive a copy: treat it as read-only.
 */
export function readSessionFlags(agentDir?: string): Map<string, SessionFlags> {
  const path = getSessionPreferencesPath(agentDir);
  const identity = readIdentity(path);
  const cached = globalThis.__piWebSessionPreferences;
  if (cached && cached.path === path && sameIdentity(cached.identity, identity)) {
    return new Map(cached.flags);
  }

  let flags = new Map<string, SessionFlags>();
  if (identity) {
    try {
      flags = parsePreferences(readFileSync(path, "utf8"));
    } catch {
      flags = new Map();
    }
  }
  globalThis.__piWebSessionPreferences = { path, identity, flags };
  return new Map(flags);
}

export function getSessionFlags(sessionId: string, agentDir?: string): SessionFlags {
  return { ...(readSessionFlags(agentDir).get(sessionId) ?? {}) };
}

/** Drops the parse cache (tests, or a manual recovery path). */
export function invalidateSessionPreferencesCache(): void {
  globalThis.__piWebSessionPreferences = undefined;
}

function writeSessionFlags(path: string, flags: Map<string, SessionFlags>): void {
  const sessions: Record<string, SessionFlags> = {};
  for (const [sessionId, value] of flags) {
    if (Object.keys(value).length > 0) sessions[sessionId] = value;
  }
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(
    path,
    `${JSON.stringify({ version: PREFERENCES_VERSION, sessions }, null, 2)}\n`,
  );
  // The written content is authoritative but the next reader would re-stat
  // anyway; dropping the cache keeps a single code path for "read from disk".
  globalThis.__piWebSessionPreferences = undefined;
}

/** Applies a validated patch in one write. Returns the effective flags. */
export function writeSessionFlagPatch(
  sessionId: string,
  patch: SessionFlagPatch,
  agentDir?: string,
): SessionFlags {
  const flags = readSessionFlags(agentDir);
  const current: SessionFlags = { ...(flags.get(sessionId) ?? {}) };
  for (const flag of SESSION_FLAGS) {
    const value = patch[flag];
    if (value === undefined) continue;
    if (value) current[flag] = true;
    else delete current[flag];
  }

  if (Object.keys(current).length > 0) flags.set(sessionId, current);
  else flags.delete(sessionId);

  writeSessionFlags(getSessionPreferencesPath(agentDir), flags);
  return current;
}

/** Forgets flags for sessions that no longer exist. Returns how many were dropped. */
export function clearSessionFlags(sessionIds: Iterable<string>, agentDir?: string): number {
  const flags = readSessionFlags(agentDir);
  let removed = 0;
  for (const sessionId of sessionIds) {
    if (flags.delete(sessionId)) removed += 1;
  }
  if (removed > 0) writeSessionFlags(getSessionPreferencesPath(agentDir), flags);
  return removed;
}

/**
 * One-shot union used by the browser migration of the old `localStorage` keys.
 * Ids that no longer resolve to a session are skipped rather than stored, so a
 * stale browser list cannot resurrect flags for deleted sessions.
 */
export function mergeSessionFlags(
  input: Partial<Record<SessionFlag, readonly string[]>>,
  allowedIds: ReadonlySet<string>,
  agentDir?: string,
): { applied: number; skipped: number } {
  const flags = readSessionFlags(agentDir);
  let applied = 0;
  let skipped = 0;

  for (const flag of SESSION_FLAGS) {
    for (const sessionId of new Set(input[flag] ?? [])) {
      if (!allowedIds.has(sessionId)) {
        skipped += 1;
        continue;
      }
      const current: SessionFlags = { ...(flags.get(sessionId) ?? {}) };
      if (current[flag]) continue;
      current[flag] = true;
      flags.set(sessionId, current);
      applied += 1;
    }
  }

  if (applied > 0) writeSessionFlags(getSessionPreferencesPath(agentDir), flags);
  return { applied, skipped };
}

/** Attaches stored flags to a session list. Pure so it is testable without fs. */
export function applySessionPreferences(
  sessions: readonly SessionInfo[],
  flags: ReadonlyMap<string, SessionFlags>,
): SessionInfo[] {
  if (flags.size === 0) return [...sessions];
  return sessions.map((session) => {
    const stored = flags.get(session.id);
    if (!stored) return session;
    return {
      ...session,
      ...(stored.pinned ? { pinned: true } : {}),
      ...(stored.hidden ? { hidden: true } : {}),
      ...(stored.unread ? { unread: true } : {}),
    };
  });
}

/** Validates one session's flag request body. */
export function parseSessionFlagPatch(value: unknown): SessionFlagPatch | null {
  if (!isRecord(value)) return null;
  const patch: SessionFlagPatch = {};
  for (const flag of SESSION_FLAGS) {
    const entry = value[flag];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") return null;
    patch[flag] = entry;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Validates a migration body: `{ pinned?: string[], hidden?: string[], unread?: string[] }`. */
export function parseSessionFlagIdLists(
  value: unknown,
): Partial<Record<SessionFlag, string[]>> | null {
  if (!isRecord(value)) return null;
  const parsed: Partial<Record<SessionFlag, string[]>> = {};
  for (const flag of SESSION_FLAGS) {
    const entry = value[flag];
    if (entry === undefined) continue;
    if (!Array.isArray(entry) || entry.length > MAX_MIGRATION_IDS_PER_FLAG) return null;
    if (entry.some((id) => typeof id !== "string" || id.length === 0)) return null;
    parsed[flag] = entry as string[];
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}
