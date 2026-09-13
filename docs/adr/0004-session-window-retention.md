# Session window retention

Pi Web keeps one live `<ChatWindow>` per visited session instead of remounting a
single window on every switch. Switching moves a window to the front; it no
longer reloads content, and a session that is still running keeps streaming
while it is in the background.

Implemented by `lib/session-windows.ts` (pure registry + retention policy) and
`components/AppShell.tsx` (owns the registry and renders the stack).

## Invariants

1. At most one window exists per session id.
2. The window in front is never destroyed.
3. A window that is interacting is never destroyed.
4. Destroying a window unmounts the component, closes its event stream and drops
   the registry entry. It never touches session data on disk.
5. A mounted window does not imply a live server-side `AgentSession`. The wrapper
   keeps its own 10 minute idle timeout (`lib/rpc-manager.ts`) and is recreated on
   demand.
6. Switching still only changes `?session=`; there is no new route.
7. Reopening a destroyed window is a fresh mount that re-reads the session file
   (possibly from the client-side session cache).

## Destroy conditions

Both must hold:

- Not interacting. `busy` is reported by the window and covers `agentRunning`,
  `bashRunning`, `isCompacting`, `loading`, an in-flight fork
  (`forkingEntryId !== null`) and a blocking extension dialog. AppShell also
  treats an unsent draft (present in `lib/draft-store.ts`) and
  `runningSessionIds` from the sidebar poll as protection.
- Not switched to for 10 minutes (`SESSION_WINDOW_IDLE_MS`). The clock is the
  time since the window was last in front. When a window stops interacting its
  clock restarts, so a long run finishing right before a sweep does not make the
  window instantly evictable (a completion notification arrives with it).

A 30 second sweep applies this. `localStorage["pi-web:session-window-idle-ms"]`
overrides the timeout for manual testing (values below one second are ignored).

## Hard cap

Idle windows beyond the cap are evicted oldest first (`MAX_SESSION_WINDOWS = 8`
desktop, `4` on mobile). Draft composers have a separate cap
(`MAX_DRAFT_WINDOWS = 2`) and never consume session slots. If every candidate is
interacting the cap is temporarily exceeded rather than destroying a live window.

Measured on 2026-09-13 (dev server, Chrome, sessions of 35–385 messages):

| mounted windows | DOM nodes | JS heap |
| --- | --- | --- |
| 1 | 1,159 | 49 MB |
| 4 | 2,302 | 63 MB |
| 7 | 3,717 | 104 MB |

So each extra window costs roughly 400 DOM nodes and (dev-mode, uncollected)
~8 MB, with DOM bounded by the 50-message render window rather than session
length. Switching between already-mounted windows settles in a single animation
frame.

Mobile re-measured on an emulated 390x844 touch viewport (DPR 3, dev server):
seven transient windows reached 4,330 DOM nodes, and the 30 s sweep brought the
set back to the cap — 4 session windows plus the project's draft composer, 2,766
nodes. The cap is therefore enforced and the retained set is bounded; the heap
readings on that run were too noisy (dev build, no forced GC) to publish, so the
number stays at 4 and is worth re-checking once on the Android WebView.

## Event streams are budgeted separately from windows

Browsers cap HTTP/1.1 connections per origin at six, and the limit is shared
across every tab of that origin. `EventSource` counts against it, `WebSocket`
does not. Pi Web already spends one slot on `/api/agent/running/events` (the PWA
badge) and up to one on a file watcher.

Which access paths are affected (verified 2026-09-13):

- `http://127.0.0.1:30141` and plain-HTTP LAN access: **HTTP/1.1**, so the limit
  applies.
- `https://xiaomi-ubuntu-pi.linmingji.com` (the tunnel): negotiates **HTTP/2**,
  where streams multiplex over one connection and the limit does not apply. A
  WebView loading the public URL is on that path too.

The budget below is therefore a correctness guard for the HTTP/1.1 paths rather
than a universal constraint, and it stays cheap enough to keep unconditionally.

Consequences:

- An idle window must not hold a stream, even though it stays mounted. Idle
  streams close after the existing 30 second grace window.
- `MAX_EVENT_STREAMS` (3 desktop, 2 mobile) limits concurrent chat streams to the
  most recently used running windows. Windows over budget fall back to the
  existing 15 second reconcile poll and the activation revalidation, which is why
  they still show complete results when the user switches to them.
- Never give each mounted window its own long-lived connection; if more
  concurrency is ever needed on HTTP/1.1, multiplex all sessions onto a single
  stream (`/api/agent/events?ids=...`).

## Coming back to the front

Windows stay mounted, so `useAgentSession` loads content in a mount effect only.
Activation therefore re-validates explicitly:

- Idle window: `loadSession(..., useCache)`. A cache hit inside the 30 second TTL
  renders from memory with no file fetch; a miss re-reads the file. The live
  `state` (context usage, queued messages, prompt) is always refreshed, since it
  is small and not part of the file snapshot.
- Running window: the stream stays authoritative. Only the state is reconciled
  and the stream is re-attached if this window owns a slot.

## Top bar state belongs to the front window

Branch tree, system prompt, tools, stats and context usage are reported to
AppShell only while the window is in front. A background window keeps its own
React state and re-emits everything on activation, which keeps N streaming
windows from re-rendering the shell and keeps the parent state unambiguous.

Each window gets a stable callback bundle (`getWindowCallbacks`) that routes
through refs and checks the current front window, so neither stale callbacks from
a background window nor React effect ordering can overwrite the front window's
displayed state.

## Hidden rendering

Hidden windows use `content-visibility: hidden` with `contain-intrinsic-size`,
which preserves their DOM, scroll position and composer state while skipping
layout and paint, and keeps their controls unfocusable. Layout-dependent work is
skipped while hidden (the prompt anchor spacer, the chat minimap) because
measuring a hidden subtree forces the browser to lay it out anyway.
