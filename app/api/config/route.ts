import { NextResponse } from "next/server";
import { parseToolInputFormat, resolveToolInputFormat, TOOL_INPUT_FORMAT_ENV } from "@/lib/tool-input-format";

// The value comes from the process environment, so the response must never be
// frozen into the build output.
export const dynamic = "force-dynamic";

let warnedRawValue: string | null = null;

/**
 * Exposes runtime display configuration to the client.
 * Change `.env` and restart the process; no rebuild is required.
 */
export async function GET() {
  const raw = process.env[TOOL_INPUT_FORMAT_ENV];
  if (raw !== undefined && parseToolInputFormat(raw) === null && warnedRawValue !== raw) {
    // Warn once per distinct bad value so operators can spot typos in logs.
    warnedRawValue = raw;
    console.warn(`[pi-web] Ignoring invalid ${TOOL_INPUT_FORMAT_ENV}=${JSON.stringify(raw)}; expected "json" or "yaml".`);
  }
  return NextResponse.json({ toolInputFormat: resolveToolInputFormat(raw) });
}
