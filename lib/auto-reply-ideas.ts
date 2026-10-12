import type { CompletedReplyTurn } from "./reply-ideas-target";

export function replyIdeasKey(target: { sessionId: string; entryId: string }): string {
  return `${target.sessionId}:${target.entryId}`;
}

/** Per-window requests and manual choices share the same once-only ledger. */
export class AutoReplyIdeas {
  private handled = new Set<string>();
  private pending: AbortController | null = null;

  cancel(): void {
    this.pending?.abort();
    this.pending = null;
  }

  suppress(target?: { sessionId: string; entryId: string }): void {
    if (target) this.handled.add(replyIdeasKey(target));
    this.cancel();
  }

  async consider(
    turn: CompletedReplyTurn,
    canOpen: () => boolean,
    open: (probability: number) => void,
    request: typeof fetch = fetch,
  ): Promise<void> {
    const key = replyIdeasKey(turn);
    if (this.handled.has(key) || !turn.isCurrent() || !canOpen()) return;
    this.handled.add(key);
    this.cancel();
    const controller = new AbortController();
    this.pending = controller;
    try {
      const response = await request(
        `/api/sessions/${encodeURIComponent(turn.sessionId)}/entries/${encodeURIComponent(turn.entryId)}/suggested-replies/decision`,
        { method: "POST", signal: controller.signal },
      );
      if (!response.ok) return;
      const result = await response.json();
      const probability = result.probability;
      if (this.pending === controller && !controller.signal.aborted
        && result.shouldOpen === true && typeof probability === "number"
        && Number.isFinite(probability) && probability >= 0 && probability <= 1
        && turn.isCurrent() && canOpen()) open(probability);
    } catch {
      // Automatic suggestions must never interrupt the conversation.
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
