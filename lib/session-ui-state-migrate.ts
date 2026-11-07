import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { getPiWebDataDir } from "./pi-web-data-dir";
import { updateSessionUiState } from "./session-ui-state";
import {
  MAX_UNREAD_IDS,
  SESSION_ID_PATTERN,
  chunkForSessionUiRequests,
} from "./session-ui-state-shared";

/**
 * One-shot import of the sidebar flags this fork used to keep for itself.
 *
 * Before the v0.12.0 merge, pin / hide / unread lived in
 * `~/.pi-web/session-preferences.json` (see the old `lib/session-preferences.ts`)
 * because upstream had no server-side sidebar state. Upstream's
 * `~/.pi/agent/pi-web-session-state.json` now holds pins, archive and project
 * order, so the legacy file is read once and folded into it:
 *
 * - `pinned` → `pinnedAt`
 * - `hidden` → `archivedAt` (the archive is what upstream shows instead)
 * - `unread` → `unreadIds` (kept server-side, as it was here)
 *
 * The legacy file is never deleted or rewritten: a rollback to the old build
 * still finds its data, and the marker beside it keeps the import to once.
 */

/** Where the fork used to keep pin / hide / unread. */
export const LEGACY_PREFERENCES_FILE = "session-preferences.json";
/** Written beside it once its flags are in the UI state file. */
export const LEGACY_MIGRATION_MARKER = "session-preferences.migrated.json";

export interface LegacySessionPreferences {
  pinned: string[];
  archived: string[];
  unread: string[];
}

/**
 * The legacy file's flags as session-id lists; null when there is nothing to
 * read (missing, unreadable, or not the shape the old build wrote).
 */
export function readLegacySessionPreferences(piWebDir = getPiWebDataDir()): LegacySessionPreferences | null {
  const path = join(piWebDir, LEGACY_PREFERENCES_FILE);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const sessions = (parsed as { sessions?: unknown }).sessions;
  if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) return null;

  const legacy: LegacySessionPreferences = { pinned: [], archived: [], unread: [] };
  for (const [id, flags] of Object.entries(sessions as Record<string, unknown>)) {
    if (!SESSION_ID_PATTERN.test(id)) continue;
    if (typeof flags !== "object" || flags === null || Array.isArray(flags)) continue;
    const record = flags as Record<string, unknown>;
    if (record.pinned === true) legacy.pinned.push(id);
    if (record.hidden === true) legacy.archived.push(id);
    if (record.unread === true) legacy.unread.push(id);
  }
  return legacy;
}

/** How many flags moved into the UI state file; 0 when there was nothing to do. */
export async function migrateLegacySessionPreferences(piWebDir = getPiWebDataDir()): Promise<number> {
  if (existsSync(join(piWebDir, LEGACY_MIGRATION_MARKER))) return 0;

  const legacy = readLegacySessionPreferences(piWebDir);
  if (!legacy) return 0;

  let moved = 0;
  try {
    for (const ids of chunkForSessionUiRequests(legacy.pinned)) {
      await updateSessionUiState({ action: "set", ids, pinned: true });
      moved += ids.length;
    }
    for (const ids of chunkForSessionUiRequests(legacy.archived)) {
      await updateSessionUiState({ action: "set", ids, archived: true });
      moved += ids.length;
    }
    for (const ids of chunkForSessionUiRequests(legacy.unread.slice(0, MAX_UNREAD_IDS))) {
      await updateSessionUiState({ action: "set", ids, unread: true });
      moved += ids.length;
    }
  } catch (error) {
    // A failed import leaves the marker unwritten, so the next start retries.
    console.warn("[pi-web] could not move the legacy session flags into the UI state:", error);
    return 0;
  }

  try {
    writePrivateFileAtomicSync(join(piWebDir, LEGACY_MIGRATION_MARKER), `${new Date().toISOString()}\n`);
  } catch (error) {
    // The flags are in place; only the "already imported" note is missing.
    console.warn("[pi-web] could not write the session flag migration marker:", error);
  }
  return moved;
}
