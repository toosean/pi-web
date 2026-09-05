/**
 * Client-side local storage cache for models and project metadata.
 *
 * Speeds up the initial render of the new-session chat input controls
 * (model selector, cwd path display, recent projects, and worktrees)
 * using a Stale-While-Revalidate pattern:
 * 1. Read cached values synchronously on mount so controls render immediately (0ms)
 * 2. Fetch fresh data in the background
 * 3. Update state and refresh the cache once the network response arrives
 */

export interface CachedModelEntry {
  id: string;
  name: string;
  provider: string;
}

export interface CachedSelectedModel {
  provider: string;
  modelId: string;
}

export interface CachedModelsData {
  models: Record<string, string>;
  modelList: CachedModelEntry[];
  defaultModel: CachedSelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  thinkingLevelPins?: Record<string, string>;
  updatedAt?: number;
}

export interface CachedWorktreeItem {
  path: string;
  branch?: string;
  isMain?: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY_MODELS = "pi-web:cached-models";
const STORAGE_KEY_HOME_DIR = "pi-web:cached-home-dir";
const STORAGE_KEY_RECENT_PROJECTS = "pi-web:cached-recent-projects";
const STORAGE_KEY_WORKTREES = "pi-web:cached-worktrees";

const MAX_CACHED_WORKTREE_CWDS = 20;

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Models Cache
// ---------------------------------------------------------------------------

export function getCachedModelsData(storage: StorageLike | null = getBrowserStorage()): CachedModelsData | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY_MODELS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const data = parsed as Partial<CachedModelsData>;
    if (!data.models || typeof data.models !== "object" || Array.isArray(data.models)) return null;
    if (!Array.isArray(data.modelList)) return null;

    return {
      models: data.models as Record<string, string>,
      modelList: data.modelList as CachedModelEntry[],
      defaultModel: data.defaultModel && typeof data.defaultModel === "object" && typeof data.defaultModel.provider === "string" && typeof data.defaultModel.modelId === "string"
        ? data.defaultModel
        : null,
      thinkingLevels: data.thinkingLevels && typeof data.thinkingLevels === "object" && !Array.isArray(data.thinkingLevels)
        ? data.thinkingLevels
        : undefined,
      thinkingLevelMaps: data.thinkingLevelMaps && typeof data.thinkingLevelMaps === "object" && !Array.isArray(data.thinkingLevelMaps)
        ? data.thinkingLevelMaps
        : undefined,
      thinkingLevelPins: data.thinkingLevelPins && typeof data.thinkingLevelPins === "object" && !Array.isArray(data.thinkingLevelPins)
        ? data.thinkingLevelPins
        : undefined,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function setCachedModelsData(data: CachedModelsData, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_MODELS, JSON.stringify({
      ...data,
      updatedAt: Date.now(),
    }));
  } catch {
    // Local storage is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Home Directory Cache
// ---------------------------------------------------------------------------

export function getCachedHomeDir(storage: StorageLike | null = getBrowserStorage()): string | null {
  if (!storage) return null;
  try {
    const val = storage.getItem(STORAGE_KEY_HOME_DIR);
    return typeof val === "string" && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

export function setCachedHomeDir(homeDir: string, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage || !homeDir) return;
  try {
    storage.setItem(STORAGE_KEY_HOME_DIR, homeDir);
  } catch {
    // Local storage is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Recent Projects Cache
// ---------------------------------------------------------------------------

export function getCachedRecentProjects(storage: StorageLike | null = getBrowserStorage()): string[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY_RECENT_PROJECTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const list = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

export function setCachedRecentProjects(projects: string[], storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    const valid = projects.filter((item) => typeof item === "string" && item.length > 0);
    storage.setItem(STORAGE_KEY_RECENT_PROJECTS, JSON.stringify(valid));
  } catch {
    // Local storage is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Worktrees Cache (keyed by cwd)
// ---------------------------------------------------------------------------

function readWorktreeMap(storage: StorageLike): Record<string, CachedWorktreeItem[] | undefined> {
  const raw = storage.getItem(STORAGE_KEY_WORKTREES);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CachedWorktreeItem[] | undefined>;
  } catch {
    return {};
  }
}

export function getCachedWorktrees(cwd: string, storage: StorageLike | null = getBrowserStorage()): CachedWorktreeItem[] | null {
  if (!storage || !cwd) return null;
  try {
    const map = readWorktreeMap(storage);
    const list = map[cwd];
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function setCachedWorktrees(cwd: string, worktrees: CachedWorktreeItem[], storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage || !cwd) return;
  try {
    const map = readWorktreeMap(storage);
    map[cwd] = worktrees;
    const keys = Object.keys(map);
    if (keys.length > MAX_CACHED_WORKTREE_CWDS) {
      // Evict oldest entries
      const toDelete = keys.slice(0, keys.length - MAX_CACHED_WORKTREE_CWDS);
      for (const k of toDelete) {
        delete map[k];
      }
    }
    storage.setItem(STORAGE_KEY_WORKTREES, JSON.stringify(map));
  } catch {
    // Local storage is best-effort.
  }
}
