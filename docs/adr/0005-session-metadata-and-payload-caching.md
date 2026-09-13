# Session metadata and payload caching

Two server-side caches remove the re-parsing that dominated the session UI on a
large history. Both are keyed on the file's identity — `(path, mtimeMs, size,
ctimeMs)` from a single `stat` — so an unchanged file is never re-read. Appends
change `size`; rewrites, migrations and renames change `mtime`/`ctimeMs`/path, so
the key is a sound invalidation signal for JSONL files.

Measured on a 824-session / 656 MB history (`dev` box, Node 22):

| Path | Before | After |
| --- | --- | --- |
| `GET /api/sessions` (sidebar refresh) | 4.8 s (SDK scan) | 20–80 ms warm |
| `GET /api/sessions/<id>` (reopen a session) | 2.2 s (parse) | 12–39 ms warm |

Cold scans stay as expensive as before (there is nothing to reuse yet), so the
win is on every refresh after the first.

## `lib/session-metadata.ts` — file → metadata

`SessionManager.listAll()` re-reads and re-parses every `.jsonl` on each call.
`listAllSessions()` now uses an incremental scanner that re-parses only files
whose identity changed; unchanged files are served from a `globalThis` map.

This reimplements SDK behavior, so parity is the correctness contract:

- The first parseable line must be a `session` header, otherwise the file yields
  nothing (this is also what makes a half-written file parse to a partial but
  valid record).
- Malformed/blank lines are skipped.
- `name` is the latest `session_info` name, trimmed; an empty name clears it.
- `messageCount` counts every `type: "message"` entry, including tool results and
  bash executions.
- `modified` is the newest `user`/`assistant` message timestamp, else the header
  timestamp, else the file mtime.
- `firstMessage` is the first user message with non-empty text; image-only
  messages do not count. Fallback `"(no messages)"`.

`lib/session-metadata.test.mjs` asserts this field-for-field against
`SessionManager.listAll()` on a fixture directory (CRLF, missing trailing
newline, malformed line, cleared name, no assistant message, fork, non-session
file, non-JSONL file, file directly in `sessions/`). To reproduce on real data,
run the server with `PI_WEB_SESSION_META_VERIFY=1`: both scanners run, every
divergence is logged, and the SDK result is returned. Any scanner failure falls
back to `SessionManager.listAll()`, so a bug here degrades to the old speed
instead of breaking the sidebar.

Note the cache is deliberately **not** cleared by `invalidateSessionListCache()`:
that one clears the aggregate response and is called on every mutation, while
file metadata only changes when a file changes.

## `lib/session-payload-cache.ts` + `lib/session-derived.ts` — file → chat payload

`GET /api/sessions/[id]` re-read, re-treed and re-counted the whole file on every
request, including "switch back to a session I already opened". The derived part
of the response (message tail, tree, leaf, stats, name, first message, subagent
record, tool names) now lives in `lib/session-derived.ts` and is cached by
`lib/session-payload-cache.ts`, keyed on the file identity **and** the request
parameters that change what is built (`tail`, `alignToTurn`, `deferThinking`,
`deferMedia`).

Two deliberate limits:

- **Only the read-only path is cached.** A session with a live `AgentSession` can
  change in memory without the file changing, so it always rebuilds.
- `info` (and therefore the git project decoration) is rebuilt per request from
  the cached primitives, so branch/worktree metadata stays as fresh as its own
  60 s cache.

Cache size is capped at 12 payloads (each holds a message tail plus a full tree)
with a 5 minute age limit as a safety net.

## Client-side draft retention

`lib/draft-store.ts` keeps at most 8 drafts, least-recently-written first, because
a draft can hold base64 attachments (up to 10 × 10 MB) and an abandoned composer
would otherwise pin them for the lifetime of the tab. A live composer rewrites
its draft on every keystroke, which refreshes its position, so only genuinely
abandoned drafts are recycled.

## Deploying this build

`next.config.ts` honours `PI_WEB_DIST_DIR`, so a production build can be prepared
in a separate directory while the live `next start` keeps serving the current
one:

```bash
PI_WEB_DIST_DIR=.next-build npm run build      # live build untouched
# then swap .next-build -> .next and restart pm2 (see /root/piweb-deploy.sh)
```

A build run this way rewrites `tsconfig.json` to include
`.next-build/types/**/*.ts`; do not commit those entries (they are only correct
while that staging directory exists). The swap waits until `/api/agent/running`
reports no running sessions, because the restart destroys every in-process
`AgentSession` wrapper.
