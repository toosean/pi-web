/**
 * Incremental session-file metadata scanner.
 *
 * `SessionManager.listAll()` re-reads and re-parses every `.jsonl` under
 * `~/.pi/agent/sessions` on each call. On a machine with hundreds of sessions
 * (and hundreds of megabytes of history) that costs seconds, and the sidebar pays
 * it on every refresh — including right after each agent turn.
 *
 * Most files never change between refreshes, so this module keeps the metadata
 * derived from each file (name, message count, first message, timestamps,
 * parent) and only re-parses files whose `(mtimeMs, size, ctimeMs)` triple
 * changed. Appends change `size`; rewrites and renames change `mtime`/path, so
 * the identity is a sound invalidation key.
 *
 * The parser mirrors the SDK's own `buildSessionInfo()` semantics exactly (see
 * `listSessionsFromDir`/`buildSessionInfo` in the SDK's session-manager) so the
 * sidebar, project list and session trees keep behaving identically. The parity
 * is asserted against the SDK in `session-metadata.test.mjs`.
 *
 * This cache is deliberately independent of `invalidateSessionListCache()`:
 * that one clears the aggregate list response and is called on every mutation,
 * while file metadata only ever changes when a file changes.
 */

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, normalize as normalizePath } from "node:path";
import { createInterface } from "node:readline";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SessionFileMetadata {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

interface MetadataCacheEntry {
  /** Identity of the file the metadata was derived from. */
  mtimeMs: number;
  size: number;
  ctimeMs: number;
  metadata: SessionFileMetadata;
}

interface MetadataCacheState {
  entries: Map<string, MetadataCacheEntry>;
  indexPath: string;
  persistQueued: boolean;
}

declare global {
  var __piSessionMetadataCache: MetadataCacheState | undefined;
}

/** Same order of magnitude as the SDK's own concurrency limits. */
const MAX_CONCURRENT_STATS = 32;
const MAX_CONCURRENT_PARSES = 10;
const INDEX_FORMAT_VERSION = 2;

function metadataIndexPath(): string {
  return join(getAgentDir(), "pi-web-session-index.json");
}

function hydratePersistedIndex(indexPath: string): Map<string, MetadataCacheEntry> {
  const entries = new Map<string, MetadataCacheEntry>();
  if (!existsSync(indexPath)) return entries;
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as {
      version?: unknown;
      entries?: unknown;
    };
    if (parsed.version !== INDEX_FORMAT_VERSION || !isRecord(parsed.entries)) return entries;
    for (const [filePath, raw] of Object.entries(parsed.entries)) {
      if (!isRecord(raw) || !isRecord(raw.metadata)) continue;
      const metadata = raw.metadata;
      if (
        typeof raw.mtimeMs !== "number" || !Number.isFinite(raw.mtimeMs)
        || typeof raw.size !== "number" || !Number.isSafeInteger(raw.size) || raw.size < 0
        || typeof raw.ctimeMs !== "number" || !Number.isFinite(raw.ctimeMs)
        || metadata.path !== filePath
        || typeof metadata.id !== "string"
        || typeof metadata.cwd !== "string"
        || (metadata.name !== undefined && typeof metadata.name !== "string")
        || (metadata.parentSessionPath !== undefined && typeof metadata.parentSessionPath !== "string")
        || typeof metadata.created !== "string"
        || typeof metadata.modified !== "string"
        || typeof metadata.messageCount !== "number" || !Number.isSafeInteger(metadata.messageCount) || metadata.messageCount < 0
        || typeof metadata.firstMessage !== "string"
      ) continue;
      const created = new Date(metadata.created);
      const modified = new Date(metadata.modified);
      if (!Number.isFinite(created.getTime()) || !Number.isFinite(modified.getTime())) continue;
      entries.set(filePath, {
        mtimeMs: raw.mtimeMs,
        size: raw.size,
        ctimeMs: raw.ctimeMs,
        metadata: {
          path: filePath,
          id: metadata.id,
          cwd: metadata.cwd,
          ...(metadata.name === undefined ? {} : { name: metadata.name }),
          ...(metadata.parentSessionPath === undefined ? {} : { parentSessionPath: metadata.parentSessionPath }),
          created,
          modified,
          messageCount: metadata.messageCount,
          firstMessage: metadata.firstMessage,
        },
      });
    }
  } catch {
    // A corrupt or stale index is only a cold-cache event.
  }
  return entries;
}

function getCache(): MetadataCacheState {
  const indexPath = metadataIndexPath();
  if (!globalThis.__piSessionMetadataCache || globalThis.__piSessionMetadataCache.indexPath !== indexPath) {
    globalThis.__piSessionMetadataCache = {
      entries: hydratePersistedIndex(indexPath),
      indexPath,
      persistQueued: false,
    };
  }
  return globalThis.__piSessionMetadataCache;
}

function queuePersistedIndex(cache: MetadataCacheState): void {
  if (cache.persistQueued) return;
  cache.persistQueued = true;
  queueMicrotask(() => {
    cache.persistQueued = false;
    try {
      const entries = Object.fromEntries([...cache.entries].map(([filePath, entry]) => [filePath, {
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        ctimeMs: entry.ctimeMs,
        metadata: entry.metadata,
      }]));
      writePrivateFileAtomicSync(cache.indexPath, JSON.stringify({ version: INDEX_FORMAT_VERSION, entries }));
    } catch {
      // Persistence is best-effort; the in-memory cache remains authoritative.
    }
  });
}

/** Drops all cached file metadata (tests, or a manual recovery path). */
export function invalidateSessionMetadataCache(): void {
  getCache().entries.clear();
}

/** Simulates a process restart without changing the persisted index. */
export function resetSessionMetadataCacheForTesting(): void {
  globalThis.__piSessionMetadataCache = undefined;
}

export function sessionMetadataCacheSize(): number {
  return getCache().entries.size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => isRecord(block) && block.type === "text")
    .map((block) => (typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
    .join(" ");
}

function messageActivityTime(entry: Record<string, unknown>): number | undefined {
  const message = entry.message;
  if (!isRecord(message)) return undefined;
  if (typeof message.role !== "string" || !("content" in message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number") return message.timestamp;
  const parsed = new Date(String(entry.timestamp ?? "")).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses one session file into metadata, or `null` when it is not a session file
 * (the first parseable line must be a `session` header — the SDK behaves the
 * same way, which is also what makes a half-written file parse to a partial but
 * valid record).
 */
export async function readSessionFileMetadata(
  filePath: string,
  fallbackMtimeMs: number,
): Promise<SessionFileMetadata | null> {
  let header: Record<string, unknown> | null = null;
  let messageCount = 0;
  let firstMessage = "";
  let name: string | undefined;
  let lastActivityTime: number | undefined;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // Skip malformed lines, like the SDK.
      }
      if (!isRecord(entry) || typeof entry.type !== "string") continue;

      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }

      if (entry.type === "session_info") {
        const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
        name = rawName || undefined;
        continue;
      }

      if (entry.type !== "message") continue;
      messageCount += 1;

      const activity = messageActivityTime(entry);
      if (typeof activity === "number") {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activity);
      }

      const message = entry.message;
      if (!isRecord(message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const text = extractTextContent(message);
      if (!text) continue;
      if (!firstMessage && message.role === "user") firstMessage = text;
    }
  } catch {
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }

  if (!header) return null;

  const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
  const modified = typeof lastActivityTime === "number" && lastActivityTime > 0
    ? new Date(lastActivityTime)
    : !Number.isNaN(headerTime)
      ? new Date(headerTime)
      : new Date(fallbackMtimeMs);

  return {
    path: filePath,
    id: String(header.id),
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    ...(name !== undefined ? { name } : {}),
    ...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
    created: new Date(String(header.timestamp)),
    modified,
    messageCount,
    firstMessage: firstMessage || "(no messages)",
  };
}

/** Lists every `*.jsonl` file under the sessions dir, one level deep. */
async function listSessionFilePaths(sessionsDir: string): Promise<string[]> {
  const dirents = await readdir(sessionsDir, { withFileTypes: true });
  const dirs = dirents
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(sessionsDir, entry.name));

  const filePaths: string[] = [];
  for (const dir of dirs) {
    try {
      const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
      for (const file of files) filePaths.push(join(dir, file));
    } catch {
      // Unreadable project dir: skip it, exactly like the SDK.
    }
  }
  return filePaths;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const inFlight = new Set<Promise<void>>();

  const startNext = (): void => {
    const index = nextIndex;
    nextIndex += 1;
    const item = items[index];
    if (item === undefined) return;
    const task: Promise<void> = worker(item)
      .then((value) => { results[index] = value; })
      .catch(() => { results[index] = undefined as unknown as R; })
      .finally(() => { inFlight.delete(task); });
    inFlight.add(task);
  };

  while (nextIndex < items.length || inFlight.size > 0) {
    while (nextIndex < items.length && inFlight.size < limit) startNext();
    if (inFlight.size > 0) await Promise.race(inFlight);
  }
  return results;
}

/**
 * Returns metadata for every session file, re-parsing only the files whose
 * identity changed since the previous call.
 */
export async function listSessionMetadata(sessionsDir: string): Promise<SessionFileMetadata[]> {
  const cache = getCache();
  const filePaths = await listSessionFilePaths(sessionsDir);
  const presentPaths = new Set(filePaths);
  const removedEntries = [...cache.entries.keys()].some((filePath) => !presentPaths.has(filePath));

  const identities = await mapWithConcurrency(filePaths, MAX_CONCURRENT_STATS, async (filePath) => {
    try {
      const stats = statSync(filePath);
      return { filePath, mtimeMs: stats.mtimeMs, size: stats.size, ctimeMs: stats.ctimeMs };
    } catch {
      return null;
    }
  });

  const nextEntries = new Map<string, MetadataCacheEntry>();
  const toParse: { filePath: string; mtimeMs: number; size: number; ctimeMs: number }[] = [];

  for (const identity of identities) {
    if (!identity) continue;
    const cached = cache.entries.get(identity.filePath);
    if (
      cached
      && cached.mtimeMs === identity.mtimeMs
      && cached.size === identity.size
      && cached.ctimeMs === identity.ctimeMs
    ) {
      nextEntries.set(identity.filePath, cached);
      continue;
    }
    toParse.push(identity);
  }

  const parsed = await mapWithConcurrency(toParse, MAX_CONCURRENT_PARSES, async (identity) => {
    const metadata = await readSessionFileMetadata(identity.filePath, identity.mtimeMs);
    return metadata ? { identity, metadata } : null;
  });

  for (const result of parsed) {
    if (!result) continue;
    nextEntries.set(result.identity.filePath, {
      mtimeMs: result.identity.mtimeMs,
      size: result.identity.size,
      ctimeMs: result.identity.ctimeMs,
      metadata: result.metadata,
    });
  }

  // Replacing the map also drops entries for deleted files.
  cache.entries = nextEntries;
  if (toParse.length > 0 || removedEntries) queuePersistedIndex(cache);

  const metadata = [...nextEntries.values()].map((entry) => entry.metadata);
  metadata.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return metadata;
}

/** Convenience wrapper for callers that only need the normalized path. */
export function normalizeSessionFilePath(filePath: string): string {
  return normalizePath(filePath);
}
