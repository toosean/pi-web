import type { ToolCallContent } from "./types";
import { isImagePath } from "./file-types";
import { resolveLocalFilePath } from "./file-links";
import { encodeFilePathForApi } from "./file-paths";
import { isReadToolName } from "./tool-names";

export interface ReadImageInfo {
  rawPath: string;
  resolvedPath: string;
  imageUrl: string;
}

export function extractToolCallPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const val = record.path ?? record.file_path ?? record.filePath ?? record.target;
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
}

export function extractReadImageInfo(
  block: ToolCallContent,
  cwd?: string,
  sessionId?: string,
): ReadImageInfo | null {
  if (!isReadToolName(block.toolName)) return null;

  let rawPath = extractToolCallPath(block.input);

  if (!rawPath && block.rawInput) {
    try {
      const parsed = JSON.parse(block.rawInput);
      rawPath = extractToolCallPath(parsed);
    } catch {
      // Streamed JSON not parseable yet
    }
  }

  if (!rawPath) return null;

  const resolvedPath = resolveLocalFilePath(rawPath, cwd) ?? rawPath;
  if (!isImagePath(resolvedPath)) return null;

  const sessionParam = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "";
  const imageUrl = `/api/files/${encodeFilePathForApi(resolvedPath)}?type=read${sessionParam}`;

  return {
    rawPath,
    resolvedPath,
    imageUrl,
  };
}
