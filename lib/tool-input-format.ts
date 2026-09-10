import { dump as stringifyYaml } from "js-yaml";
import type { ToolCallContent } from "./types";

/** Rendering format for the tool-call argument box. */
export type ToolInputFormat = "json" | "yaml";

/** Environment variable read by `GET /api/config`. Values: `json` (default) or `yaml`. */
export const TOOL_INPUT_FORMAT_ENV = "PI_WEB_TOOL_INPUT_FORMAT";

/** Keeps the historical JSON rendering when nothing is configured. */
export const DEFAULT_TOOL_INPUT_FORMAT: ToolInputFormat = "json";

export function isToolInputFormat(value: unknown): value is ToolInputFormat {
  return value === "json" || value === "yaml";
}

/**
 * Strictly parses a configured value. Returns `null` for anything that is not a
 * recognized format so callers can warn about typos instead of silently
 * falling back.
 */
export function parseToolInputFormat(raw: unknown): ToolInputFormat | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "yaml" || value === "yml") return "yaml";
  if (value === "json") return "json";
  return null;
}

export function resolveToolInputFormat(raw: unknown): ToolInputFormat {
  return parseToolInputFormat(raw) ?? DEFAULT_TOOL_INPUT_FORMAT;
}

const YAML_DUMP_OPTIONS = {
  // Anchors/aliases (`&a` / `*a`) are noise in a read-only argument view.
  noRefs: true,
  // Never fold long single-line values; wrapping reads like changed content.
  lineWidth: -1,
  // Pin the indentation instead of inheriting a js-yaml major's default.
  indent: 2,
} as const;

/**
 * Drops the newline the YAML emitter always appends so the rendered block does
 * not grow a blank line. Keep-chomping documents (`|+`) end with `\n\n` and are
 * left untouched, because there those blank lines are actual content.
 */
function trimEmitterNewline(dumped: string): string {
  return dumped.endsWith("\n") && !dumped.endsWith("\n\n") ? dumped.slice(0, -1) : dumped;
}

/**
 * Serializes tool arguments for display. Multi-line strings become literal
 * block scalars (`key: |`), which is how shell commands stay readable.
 *
 * Falls back to JSON for values YAML cannot represent (functions, BigInt).
 */
export function formatToolInput(input: Record<string, unknown>, format: ToolInputFormat): string {
  if (format === "yaml") {
    try {
      return trimEmitterNewline(stringifyYaml(input, YAML_DUMP_OPTIONS));
    } catch {
      // YAML cannot dump every value (functions, BigInt); fall back to JSON.
    }
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    // Never throw from a render path, even for values JSON cannot express.
    return String(input);
  }
}

/**
 * Text for the expanded tool-argument box. Streamed arguments are incomplete
 * JSON fragments and stay verbatim in every format.
 */
export function formatToolCallInput(block: ToolCallContent, format: ToolInputFormat): string {
  if (typeof block.rawInput === "string") return block.rawInput;
  return formatToolInput(block.input, format);
}
