import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "./message-display";
import type { AgentMessage, AssistantMessage } from "./types";

export interface CompletedReplyTurn {
  sessionId: string;
  entryId: string;
  leafId: string | null;
  /** Invalidated synchronously by new runs, aborts and navigation. */
  isCurrent: () => boolean;
}

/** Match the visible answer, excluding reasoning, tools and incomplete turns. */
export function replyIdeasText(message: AgentMessage): string {
  if (message.role !== "assistant" || message.errorMessage
    || (message.stopReason && message.stopReason !== "stop")) return "";
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.text).join("\n").trim();
}

export function latestReplyIdeasEntry(messages: readonly AgentMessage[], entryIds: readonly string[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (isMessageGroupAnchor(message)) return null;
    if (message.role === "assistant") return replyIdeasText(message) ? entryIds[i] ?? null : null;
  }
  return null;
}

/** Tracks actual runs; loading an idle session never arms a completion. */
export class ReplyIdeasTurnTracker {
  private generation = 0;
  private running = false;
  private previousEntries = new Set<string>();

  start(entryIds: readonly string[]): void {
    if (!this.running) this.previousEntries = new Set(entryIds);
    this.running = true;
    this.generation++;
  }

  invalidate(): void {
    this.generation++;
    this.running = false;
  }

  settle(eligible: boolean): { accepts: (entryId: string) => boolean; isCurrent: () => boolean } | null {
    if (!this.running) return null;
    this.running = false;
    const generation = this.generation;
    const previousEntries = this.previousEntries;
    return eligible ? {
      isCurrent: () => this.generation === generation,
      accepts: (entryId) => this.generation === generation && !previousEntries.has(entryId),
    } : null;
  }
}
