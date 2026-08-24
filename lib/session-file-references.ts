import { getSessionEntries, resolveSessionPath } from "./session-reader";
export { isFilePathReferencedByEntries } from "./session-file-references-core";
import {
  isBashOutputPathReferencedByEntries,
  isFilePathReferencedByEntries,
  isValidSessionId,
} from "./session-file-references-core";

export async function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const activeSession = globalThis.__piSessions?.get(sessionId);
    if (activeSession) {
      const messages = activeSession.inner?.agent?.state?.messages ?? [];
      const sessionCwd = activeSession.inner?.sessionManager?.getCwd?.() ?? "";
      const syntheticEntries = [
        ...(sessionCwd ? [{ type: "session" as const, id: sessionId, timestamp: new Date().toISOString(), cwd: sessionCwd }] : []),
        ...messages.map((m: unknown, idx: number) => ({
          type: "message" as const,
          id: `mem-${idx}`,
          parentId: null,
          timestamp: new Date().toISOString(),
          message: m,
        })),
      ];
      if (isFilePathReferencedByEntries(filePath, syntheticEntries as never)) {
        return true;
      }
    }

    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isFilePathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}

export async function isBashOutputPathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isBashOutputPathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}
