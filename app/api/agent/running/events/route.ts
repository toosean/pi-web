import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2_500;
const HEARTBEAT_INTERVAL_MS = 30_000;

function runningSnapshot(): string {
  return JSON.stringify({
    type: "running",
    runningSessionIds: getRunningRpcSessionIds(),
    completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
  });
}

// GET /api/agent/running/events - Background-safe running-state updates for PWA badging.
export async function GET(request: Request): Promise<Response> {
  let cancel = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let previous = "";
      const enqueue = (value: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          cleanup(false);
        }
      };
      const publish = () => {
        const snapshot = runningSnapshot();
        if (snapshot === previous) return;
        previous = snapshot;
        enqueue(`data: ${snapshot}\n\n`);
      };
      const poll = setInterval(publish, POLL_INTERVAL_MS);
      const heartbeat = setInterval(() => enqueue(":\n\n"), HEARTBEAT_INTERVAL_MS);
      const onAbort = () => cleanup(true);
      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onAbort);
        if (closeController) {
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      cancel = () => cleanup(false);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) cleanup(true);
      else publish();
    },
    cancel() {
      cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
