import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * pi-web's own state directory (`~/.pi-web`), a sibling of `~/.pi`.
 *
 * Anything pi-web persists that is *not* pi session content lives here: Web Push
 * keys/subscriptions and the sidebar session flags. Keeping it out of
 * `~/.pi/agent` means pi's own tooling never has to know about these files.
 */
export function getPiWebDataDir(agentDir?: string): string {
  try {
    return join(agentDir ?? getAgentDir(), "..", "pi-web");
  } catch {
    return join(homedir(), ".pi-web");
  }
}

/** Same as `getPiWebDataDir()`, created with private permissions on demand. */
export function ensurePiWebDataDir(agentDir?: string): string {
  const dir = getPiWebDataDir(agentDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
