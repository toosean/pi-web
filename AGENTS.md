# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

### Dev server troubleshooting

- Before starting a server, run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse the existing Pi Web process when it is healthy. A second `next dev` for the same checkout cannot use a different port as a workaround because both processes contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph; it does not prove the server or source is broken. First call the browser's explicit reload action, then compare the current server log and a direct HTTP/API request.
- Restart only after the failure reproduces from a fresh page and the server-side checks also fail. Stop the exact dev process gracefully, move `.next` into a `mktemp -d` backup, and restart with the standard `npm run dev` command.
- Do not use `next dev --webpack` as a fallback. This repository's development graph can fail on `undici` imports such as `node:console`; development is expected to use Turbopack.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md` when `next dev` starts. Treat that as generated tooling output, verify it with `git status`, and do not include it in an unrelated feature commit.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/prefs/route.ts    PUT pinned/hidden/unread for one session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  auth/api-key/[provider]/route.ts POST/DELETE provider API key storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth and API-key provider lists
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  subagents/settings/route.ts     GET/PUT built-in subagent feature setting
  worktrees/route.ts              GET/POST/DELETE git worktrees
  session-preferences/migrate/route.ts  POST one-shot import of legacy localStorage flags
  push/subscribe/route.ts         GET VAPID public key | POST/DELETE push subscription registration

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  draft-store.ts      in-memory composer drafts, LRU-capped at 8 (attachments are base64)
  pi-types.ts          local structural types for pi SDK objects
  pi-web-data-dir.ts   ~/.pi-web state dir shared by flags and Web Push
  session-preferences.ts  server storage + validation for pin/hide/unread flags
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-metadata.ts incremental file→metadata scanner replacing SessionManager.listAll() (ADR-0005)
  session-derived.ts  the file-derived half of GET /api/sessions/[id] (tail/tree/stats)
  session-payload-cache.ts server cache for session-derived.ts, keyed on file identity (ADR-0005)
  session-cache.ts    client-side SessionData cache (30s TTL) for instant window reopen
  session-windows.ts  mounted ChatWindow registry + retention policy (see ADR-0004)
  push-notifier.ts    VAPID keys + push subscription store + sendPushNotification (Web Push)
  subagent-settings.ts  read/write ~/.pi/agent/agents/settings.json
  tool-presets.ts     PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  PushNotificationToggle.tsx sidebar Web Push on/off toggle
  PwaBadge.tsx        App Badging API: running-session count on the installed icon
  PwaInstallPrompt.tsx beforeinstallprompt / iOS add-to-homescreen prompt
  PwaRegistration.tsx service-worker registration (production only)
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  usePushNotifications.ts Web Push subscribe/unsubscribe lifecycle + permission state
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Session windows stay mounted (`lib/session-windows.ts`)
Switching sessions no longer remounts the chat. AppShell renders one
`<ChatWindow>` per visited session inside a stack and only toggles which one is
visible (`content-visibility`), so a window keeps its messages, composer, scroll
position and stream while in the background. See ADR-0004 for the full contract.

- Retention is a pure function: `selectDestroyableWindowIds()`. A window is only
  recycled when it is not in front, not interacting, and holds no unsent draft;
  the idle timeout is 10 minutes from its last activation, with a 30s sweep.
- `windowId` is the React key and never changes. Promoting a fresh composer into
  a real session (`promoteWindow`) must keep it, or the in-flight stream dies.
- Per-window state that AppShell displays (branch tree, system prompt, tools,
  stats, context usage) is reported only while that window is in front; the
  window re-emits on activation. Never let a background window write into the
  top bar, and never build per-window callbacks inline in render — use
  `getWindowCallbacks(windowId)` so `useAgentSession`'s registration effects
  (e.g. the lazy system-info loader) do not restart on every shell render.
- Never hold an SSE stream for an idle mounted window: browsers cap HTTP/1.1
  connections per origin at six, shared across tabs, and `EventSource` counts
  against it. `MAX_EVENT_STREAMS` budgets the streams; over-budget windows fall
  back to the 15s reconcile poll.
- Hidden windows must not run layout-dependent work (prompt-anchor measurement,
  the chat minimap) or the browser lays the hidden subtree out anyway.

### Sidebar flags (pin / hide / unread) are server state, not file state

`~/.pi-web/session-preferences.json` holds them and `GET /api/sessions` attaches
them to each `SessionInfo` (`lib/session-preferences.ts`). See ADR-0006.

- Decorate the catalogue **after** `listAllSessions()`/`mergeSessionLists()`.
  Flags are not file-derived, so `PUT /api/sessions/[id]/prefs` must invalidate
  neither the session-list cache nor the metadata cache; baking flags into the
  catalogue would force `invalidateSessionListCache()` on every pin.
- Reads are fail-soft (corrupt file = no flags), because the sidebar cannot render
  without the session list.
- An id missing from the catalogue is only pruned when `resolveSessionPath()`
  cannot resolve it either — a transient file read failure must never erase pins.
- The client keeps its sets as the working copy: an effect diffs and PUTs, and
  each list response adopts server flags except for a flag whose write is still in
  flight. A failed write is not retried; the next refresh re-adopts.
- `pi-web:pinned-session-ids` / `-hidden-` / `-unread-` are read once and imported
  through `POST /api/session-preferences/migrate`, then deleted.

### Session listing and detail payloads are cached by file identity
Both the sidebar catalogue and the per-session chat payload are derived from
`.jsonl` files, and both used to re-read every file on every request — seconds of
`JSON.parse` on a large history. `lib/session-metadata.ts` and
`lib/session-payload-cache.ts` key their results on `(path, mtimeMs, size,
ctimeMs)` from one `stat`, so an unchanged file is served from memory. See
ADR-0005 for the parity contract, the fallbacks and the measurements.

- `listAllSessions()` no longer calls `SessionManager.listAll()` directly. If you
  change how the catalogue is *consumed* in tests, inject one with
  `setSessionCatalogLoaderForTesting()` instead of stubbing the SDK static.
- Never let `invalidateSessionListCache()` (called on every mutation) clear the
  file metadata cache: that would reintroduce the full re-parse on every refresh.
- Only the read-only path may reuse a cached detail payload. A live
  `AgentSession` changes in memory without touching the file.
- `PI_WEB_SESSION_META_VERIFY=1` runs the SDK scan alongside the incremental one
  and logs divergences while returning the SDK result.

### Deploying: prepare the build in a separate dist dir
`next.config.ts` honours `PI_WEB_DIST_DIR`, so `PI_WEB_DIST_DIR=.next-build npm
run build` prepares a release without touching the `.next` a live `next start` is
serving (that build rewrites `tsconfig.json` to include `.next-build/types` — do
not commit it). Swapping `.next-build` into `.next` and restarting pm2 destroys
every in-process `AgentSession` wrapper, so wait until `/api/agent/running`
reports no running sessions (see `/root/piweb-deploy.sh`, which also rolls back on
a failed health check). Restart pm2 **without** `--update-env` so the archived
`PI_WEB_*` environment survives.

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** ("New session" on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** ("Edit from here" / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `handleAgentEvent` in `hooks/useAgentSession.ts` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` -> `toolNames[]`) and persisted in versioned `pi-web:tool-selection` custom entries. No entry means a legacy session and keeps Pi's default behavior; an empty array means Chat only. Chat only resolves before services are created, loads no extensions/skills/prompts/themes, and replaces Pi's base prompt with the ordered contents of Pi's discovered context files. Crossing the Chat-only boundary rebuilds the wrapper; changing between nonempty presets updates it in place. Subagents persist their active tools plus profile-level skill and extension loading switches in `resourceSnapshot`; loaded extensions cannot expose the reserved `Agent`, `get_subagent_result`, or `steer_subagent` tools to a subagent. See `docs/adr/0002-chat-only-tool-selection.md`.

The last preset explicitly selected by the user is stored in browser `localStorage` and initializes fresh-session composers only. Existing sessions never trust that preference; they use their live `get_tools` state or pi's default when no wrapper exists.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount — and again whenever a mounted window comes back to the front — `loadSession(..., includeState)` hits `GET /api/sessions/[id]/state` (`GET /api/agent/[id]` semantics for a live wrapper). If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response. A window that is already streaming when it comes back is left alone (only the state is reconciled), so a re-fetch can never clobber streamed messages.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- A stream is only attached while the window owns one of the `MAX_EVENT_STREAMS` slots (ADR-0004) and never while the window is idle, so N mounted windows do not consume N of the browser's six HTTP/1.1 connections per origin.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare paths with `samePath()`, never `===` — raw equality made `isTopLevel` permanently false on Windows and hid the worktree switcher entirely. Branch names are not paths and must keep their forward slashes. Browser code cannot apply Node path rules, so `/api/worktrees` resolves `currentWorktreePath` server-side; the sidebar must use that identity for highlighting and removal fallback.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides, so either path form authorizes correctly. Keep that one implementation — it is the security boundary.
- A UNC cwd (`\\host\share\dir`) must survive the `/api/files/[...path]` round-trip. `encodeFilePathForApi()` folds the `//` root into the first segment (`%2F%2Fhost`) because a literal `//` URL prefix is 308-normalized away before routing; `filePathFromApiSegments()` decodes it back. Never split UNC paths into segments and rejoin them — that silently turns `\\host\share` into the relative-looking `host/share` and every allow-check fails with 403.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Built-in subagents
- The global `builtInEnabled` switch is persisted in `~/.pi/agent/agents/settings.json` and defaults to `false` when the file or field is absent. Malformed settings fail closed; atomic updates preserve unknown fields.
- The inline built-in extension factory is always present so reloading an existing wrapper can apply setting changes, but it registers no tools while disabled. After changing the switch, the user must explicitly reload the current session.
- When enabled, only a recognized legacy `pi-subagents` extension that registers any reserved tool (`Agent`, `get_subagent_result`, or `steer_subagent`) is removed. Unrelated extensions remain loaded, and resolved conflict diagnostics are discarded.
- Runtime `Agent` dispatch checks the setting again so a stale tool call cannot start a subagent after the feature is switched off.
- See `docs/adr/0003-built-in-subagent-toggle.md` for the precedence and persistence rationale.
- Agent profile files (`~/.pi/agent/agents/*.md`, project `.pi/agents/*.md`) are shared with other runtimes, so a save round-trips the frontmatter keys this app does not own (`name`, `allowed_subagents`, `exclude_extensions`, `disallowed_tools`, …) and carries foreign `ext:` tool selectors through. Managed keys are exactly `description`, `display_name`, `tools`, `load_skills`, `load_extensions`, `enabled`, `inherit_context`, `run_in_background`, `model`, `thinking`, `max_turns`.
- The `skills` / `extensions` spellings pi-subagents reads are seeded on first save and kept in step while they are booleans; a hand-authored whitelist such as `extensions: pi-advisor-flow` is never rewritten, and the two flags fall back to those aliases when `load_skills` / `load_extensions` are absent.

### Web password throttling
- `lib/auth-throttle.ts` is deliberately global, not per-IP: Next 16 route handlers have no socket address and `x-forwarded-for` is spoofable, while the server binds `127.0.0.1` for a single operator. Failures double the delay (1s → 60s cap) for everyone; a success or 5 idle minutes resets it. The reset window must stay longer than the max delay or waiting out one block restarts the burst.
- State lives on `globalThis` under `Symbol.for("pi-web:auth-throttle")` so it survives hot reload and is shared by every module instance. Tests reset it with `recordAuthSuccess()`.
- Only `POST /api/web-auth` is throttled. The Basic auth branch in `proxy.ts` is not, because sharing state between the proxy bundle and route handlers has not been verified.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
