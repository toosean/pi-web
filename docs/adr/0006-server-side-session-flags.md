# Server-persisted sidebar session flags

The sidebar's three per-session flags — **pin**, **hide** and **unread** — are
persisted server-side in `~/.pi-web/session-preferences.json` and delivered on
`SessionInfo` (`pinned` / `hidden` / `unread`) by `GET /api/sessions`.

They used to live in browser `localStorage` (`pi-web:pinned-session-ids`,
`-hidden-`, `-unread-`), which made them a property of one browser profile: a
second device saw none of them, clearing site data lost them, and two open tabs
could not see each other's changes.

## Why an sidecar file and not the session `.jsonl`

Pi Web already writes `pi-web:*` custom entries into session files for things it
co-owns with pi (`pi-web:tool-selection`, `pi-web:subagent`). Pin/hide/unread are
different: they are *viewer* state, not session content.

- Appending to a session log would leak UI state into pi's data, be inherited by
  forks, and appear in exported HTML.
- Flag changes would have to touch the file, invalidating the per-file metadata
  cache and the derived payload cache that ADR-0005 exists to protect.
- A runtime session that has no file yet could not be pinned at all.

`~/.pi-web` is pi-web's own state directory (shared with the Web Push VAPID keys
and subscriptions via `lib/pi-web-data-dir.ts`), so nothing here changes what pi
itself owns.

## Storage shape

```json
{ "version": 1, "sessions": { "<session-id>": { "pinned": true, "hidden": true } } }
```

Only set flags are stored: an absent key means "not set", so unpinning deletes
and the file stays proportional to the flags in use. The whole parsed file is
cached under its `(path, mtimeMs, size, ctimeMs)` identity, so a sidebar refresh
with no flag change costs one `stat`. Reads are fail-soft: a corrupt or
unreadable file behaves like an empty one instead of failing the session-list
request the sidebar depends on — the same errors `localStorage` used to swallow.
Writes go through `writePrivateFileAtomicSync()` after a read-modify-write inside
one synchronous function, which serializes concurrent flag changes in a
single-process server.

## Flags decorate the cached catalogue

`GET /api/sessions` applies the flags **after** `listAllSessions()` and
`mergeSessionLists()`. This is the load-bearing detail, and the exact inverse of
the ADR-0005 rule: the session catalogue and the per-file metadata cache are
file-derived, and a flag change does not touch any file. Baking flags into
`listAllSessions()` would force `invalidateSessionListCache()` on every pin —
and would let the TTL cache serve stale flags.

Consequently `PUT /api/sessions/[id]/prefs` invalidates nothing.

## Pruning

`DELETE /api/sessions/[id]` clears that session's flags explicitly. Sessions can
also disappear without pi-web being involved (the pi TUI, a manual `rm`), so the
list route drops flags for ids that are **both** missing from the catalogue and
unresolvable via `resolveSessionPath()`. The second check matters: a transient
file read failure must never silently erase a user's pins, and it costs one
suffix scan only when an orphan actually exists.

## Client contract

React state stays the working copy, so the existing call sites (pin toggle,
hide/unhide, the running/completion and selection transitions for unread) are
unchanged. Two effects make it durable:

- **Adopt**: each list response replaces the local sets with the server's flags,
  so a flag set in another tab or device appears here. Adoption is skipped for a
  flag whose write is still in flight (a `pendingFlagWritesRef` counter), because
  a response computed before that write landed would revert it.
- **Sync**: each set has an effect that diffs it against the last synced state and
  PUTs one request per added/removed id. A failed write is reported and then left
  alone — the next refresh adopts the server's state, so the UI self-heals rather
  than retrying against an unreachable backend.

Subagent sessions are still never marked unread by this client, for the same
reason as before: their completion is intentionally silent.

A browser that still holds the old `localStorage` keys imports them once through
`POST /api/session-preferences/migrate`, which unions them with the server's
state and skips ids that no longer resolve. The keys are only removed after that
request succeeds, so a failed migration is retried on the next mount. Multi-client
edits are last-write-wins; no merging is attempted.
