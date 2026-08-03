export type WebuiFooterChangedFile = {
  kind: "staged" | "modified" | "untracked" | "conflicted";
  path: string;
  oldPath?: string;
  status: string;
};

export type WebuiFooterChip = {
  key: string;
  label: string;
  value: string;
  icon?: string;
  tone?: "pink" | "blue" | "mauve" | "yellow" | "green" | "teal";
  title?: string;
  action?: "calibrate-current" | "calibrate-probe";
  files?: WebuiFooterChangedFile[];
  filesTotal?: number;
  filesTruncated?: boolean;
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
  };
  usageWindows?: {
    primaryPercent: number;
    secondaryPercent: number;
  };
};

export type WebuiFooterPayload = {
  type: "firstpick.git-footer-status.footer";
  version: number;
  generatedAt: number;
  main: WebuiFooterChip[];
  meta: WebuiFooterChip[];
  visibility?: Record<string, boolean>;
};

export function parseWebuiFooterPayload(text: string): WebuiFooterPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const data = JSON.parse(trimmed) as Partial<WebuiFooterPayload>;
    if (
      data &&
      data.type === "firstpick.git-footer-status.footer" &&
      Array.isArray(data.main) &&
      Array.isArray(data.meta)
    ) {
      return data as WebuiFooterPayload;
    }
  } catch {
    // Ignore invalid JSON
  }
  return null;
}
