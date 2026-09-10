"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_TOOL_INPUT_FORMAT, isToolInputFormat, type ToolInputFormat } from "@/lib/tool-input-format";

const ToolInputFormatContext = createContext<ToolInputFormat>(DEFAULT_TOOL_INPUT_FORMAT);

/**
 * Loads the server-side display configuration once per page load.
 *
 * The default matches the server-rendered markup, so the first client render is
 * identical and hydration stays clean; changing the format requires editing
 * `.env` and restarting the process, hence no live re-fetch.
 */
export function ToolInputFormatProvider({ children }: { children: React.ReactNode }) {
  const [format, setFormat] = useState<ToolInputFormat>(DEFAULT_TOOL_INPUT_FORMAT);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const value = (data as { toolInputFormat?: unknown } | null)?.toolInputFormat;
        if (isToolInputFormat(value)) setFormat(value);
      })
      .catch(() => {
        // Configuration is best-effort; keep the default format.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ToolInputFormatContext.Provider value={format}>{children}</ToolInputFormatContext.Provider>;
}

/**
 * Current tool-argument display format. Components outside the provider (tests,
 * isolated renders) get `DEFAULT_TOOL_INPUT_FORMAT`.
 */
export function useToolInputFormat(): ToolInputFormat {
  return useContext(ToolInputFormatContext);
}
