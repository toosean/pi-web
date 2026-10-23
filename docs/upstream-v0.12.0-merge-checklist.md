# 上游 v0.12.0 合并核对表

> 状态：**冲突已全部消除，构建尚未开始；单测 49 项失败待修**。`git merge v0.12.0` 仍在进行，`MERGE_HEAD` 存在，尚未提交。
> 已达成：`tsc --noEmit` 0 error、`npm run lint` 0 error（仅剩既有 `PwaInstallPrompt` `<img>` 警告）、`npm test` 2813/2863 通过。
> 未达成：`npm test` 49 项失败、`test:terminal`/`test:e2e`/构建/上线均未开始。
> 本文档记录已完成的部分、关键判断与剩余工作，供接续执行。

## 1. 合并范围

- 集成分支：`codex/merge-upstream-v0.12.0`（从 `main@7e3c50d` 起）
- 本地基线：`main@7e3c50d`（含合并前 WIP 存档提交）
- 上游目标：`upstream/main@894e1a2`（Release v0.12.0）
- 共同祖先：`860698a`
- 规模：上游领先 299 提交（共同祖先起 290），本地领先 51 提交
- 双方共同改动 74 个文件，`git merge-tree` 干跑文件级冲突 67 个
- 实际冲突路径 53 个（46 UU / 5 UD / 2 DU）

## 2. 已完成的冲突解决（51 / 53 个路径）

### G6 构建与运维

- `package.json`：保留本地 `lucide-react`，采用上游 `next 16.3.8`；`eslint-config-next` 同步
- `next.config.ts`：本地 `PI_WEB_DIST_DIR` 的 `distDir` 与上游 `experimental.proxyClientMaxBodySize` 并存
- `eslint.config.mjs`：`.next*/**` 与 `demo/**` 两个 ignore 合并
- `package-lock.json`：同上版本对齐
- `bin/pi-web.js` / `bin/pi-web-options.js`：以上游 CLI 子命令结构为基线，重新移植本地 `--allow-all-files` / `PI_WEB_ALLOW_ALL_FILES` / `PI_WEB_DISABLE_FILE_SECURITY`
- `public/sw.js`：本地 Stale-While-Revalidate + `CACHE_SCHEMA v3` 与上游 `fetchWithTimeout`、`/manifest.webmanifest` 旁路合并；顺带修掉本地 precache 的失效 `/favicon.ico`
- `AGENTS.md`：采用上游结构，追加 "Local Fork Notes" 记录本 fork 的全部刻意差异
- `README.md`：本地新增环境变量与上游 `PI_WEB_SHUTDOWN_DEADLINE_MS` 并列

### G1 i18n

- `lib/i18n/messages/en.ts`、`zh-CN.ts`：保留本地新增 key；`zh-TW.ts` 自动合并

### 服务端

- `lib/session-reader.ts`：**以上游 scanner 为唯一扫描器**；分页保留本地 `alignToTurn`，并吸收上游的 `turnsBefore`、可见消息计数（`countsTowardTail` / `rawWindowCap`）
- `lib/session-list-scanner.ts`：恢复（上游版），并把本地的 `ctimeMs` 指纹并入 `Fingerprint`（`INDEX_FORMAT_VERSION` 1 → 2），保留"同大小同 mtime 但 ctime 变化仍重解析"的本地保证
- 删除本地 `lib/session-metadata.ts` 与其测试（被上游 scanner 取代）
- `lib/session-reader.ts` 的目录加载：保留本地测试缝合 `setSessionCatalogLoaderForTesting`，主路径改走 `listSessionsIncremental()`；上游的 `resolveScannedSessionRelation` + `scannedSubagentRuns` 弱引用缓存一并保留
- `app/api/sessions/route.ts`：采用上游版本（`summary=1` 首屏懒详情、`awaitingInputSessionIds`），移除本地 flags 装饰
- `app/api/sessions/[id]/route.ts`：GET 保留本地 `session-payload-cache` + `lib/session-derived.ts`（`alignToTurn`、`summaryTree`、`snapshotRevision`、`sourceId`），改用上游 `openSessionManager`；DELETE 采用上游 `deleteSessions()`
- `lib/session-title.ts`：采用上游直连流式实现 + 保留本地 `isAutoGenerateTitleEnabled`
- `lib/rpc-manager.ts`：保留本地服务端自动生成标题钩子（`agent_settled` / `prompt_done`）+ 上游 `trackActiveToolEvent` / `promptDoneEvent`
- `lib/file-access.ts`：保留本地 `isFileSecurityDisabled`（`PI_WEB_ALLOW_ALL_FILES`）与上游 `allowed-roots` / `path-security` 结构
- `lib/session-file-references-core.ts`：本地的 cwd 相对路径授权 + 上游的 `PATH_REPORTING_TOOL_NAMES` / `codemode-store` / `context_edit` 加固合并
- `lib/markdown.ts`：新增 `markdownAppUrlTransform`，`markdownUrlTransform` = 本地 localhost 替换 + 上游 app 链接
- `lib/message-display.ts`、`lib/web-push.ts`、`lib/pi-types.ts`：双向并集

### G2 状态层（已落地）

- 上游 `lib/session-ui-state-shared.ts` 新增 `unreadIds`：类型、`MAX_UNREAD_IDS=2000`、`UNREAD_MAX_BYTES=128KiB`、`normalizeSessionUiState` 归一化、`copyState` 深拷贝、`set` 动作支持 `unread`
- `lib/session-ui-state.ts` 的 `KNOWN_KEYS` 增加 `unreadIds`
- 新增 `lib/session-ui-state-migrate.ts`：启动时一次性把 `~/.pi-web/session-preferences.json` 折进上游状态文件（`pinned`→`pinnedAt`、`hidden`→`archivedAt`、`unread`→`unreadIds`），旧文件只读不删，写 `session-preferences.migrated.json` 标记，失败可重试；已挂到 `instrumentation-node.ts`
- 删除本地状态层：`lib/session-preferences.ts` + 测试、`app/api/sessions/[id]/prefs/`、`app/api/session-preferences/migrate/`、`app/api/sessions/prefs-route.test.mjs`

### G4 聊天与组件

- `components/ChatWindow.tsx`：保留本地窗口 props（`windowId`/`isActive`/`allowEventStream`/`reloadKey`/`onChatInputReady`/`onWindowBusyChange`/`onCwdChange`/`holdAudio`）与 ask-user；采用上游 `streamingStore` + `useStreamingSelector`（替换本地 `streamState`）、快照快速路径、`updatePromptAnchor`
- `hooks/useAgentSession.ts`：`loadSession` 统一为 options 形式（`force` / `useCache` / `revalidateOnCacheHit` / `preserveLoadedHistory` / `observer`），保留本地客户端缓存快速路径与 `preserveLoadedHistory`，吸收上游 single-flight、revision 一致性检查、`applyContextUsage`、`refreshContextUsage`；抽出 `loadLiveState` 供缓存路径与完整加载共用；保留全部窗口 ref
- `components/ChatInput.tsx`、`components/MessageView.tsx`：本地（`$` 技能补全、通用文件、YAML 工具参数、图片缩略图、ask-user）+ 上游（`enterSendMode`、`onAttachFiles`、`isToolCallExpanded`、apply-patch、codemode、MCP 标签、截断提示、`recoverTruncation`）双向并集
- `components/MarkdownBody.tsx`、`ExtensionStatusBar.tsx`、`FileViewer.tsx`、`FileExplorer.tsx`、`MermaidBlock.tsx`：双向并集（含本地 Panel 级全屏、文件区溢出折叠、上游按需 Prism 语言与 `ImagePreview`）
- 测试：`lib/markdown.test.mjs`、`lib/file-access.test.mjs`、`lib/session-reader.test.mjs`、`lib/session-reader.pagination.test.mjs`、`components/MessageView.test.mjs`、`components/MarkdownBody.test.mjs`、`components/FileViewer.test.mjs`、`components/ChatWindow.quoted-branch.test.mjs`、`components/AppShell.workspace-memory.test.mjs`
- 保留本地 5 个被上游删除的测试文件（`detail-route`、`AppShell.auto-name`、`AppShell.mobile-toolbar`、`ChatWindow.process-details`、`useAgentSession.test`）

## 3. 关键判断（偏离计划字面写法，已与用户确认）

1. **扫描器只留一个**：以上游 `session-list-scanner.ts` 为唯一扫描器，本地 `ctime` 指纹并入其中，删除本地 `lib/session-metadata.ts`。
2. **保留本地载荷缓存**：`lib/session-payload-cache.ts` + `lib/session-derived.ts` 保留，并把上游 `snapshotRevision`、`tree=summary` 并入派生载荷。
3. **未读并入上游 `ui-state`**（用户选定），不单独存文件。
4. **侧边栏以上游为基线**（用户选定），本地能力重新移植。

## 4. 剩余工作（未完成）

### 4.1 已落地的结构决策（本次）

- `components/AppShell.tsx`：**保留本地窗口架构**（`sessionWindows` / 窗口栈渲染 / 每窗口回调 / 草稿与滚动 / `retainAbortHandlers`）
- `components/SessionSidebar.tsx`：**上游 v0.12.0 侧边栏为基线**，已移植本地未读（改接 `ui-state.unreadIds`，本地镜像 + 差分写回 + 首次导入 localStorage）与 `pendingSession` 行
- `components/MessageView.tsx`：移除因上游改用 `onOpenSubagent` 侧栏标签而失效的本地 `onOpenSession` / `onNavigate` 链路；把本地 `getWrittenFileText` 接回展开的输入框（满足上游 write 卡片测试）
- `lib/rpc-manager.ts`：移除本地 `persistExplicitStartupPreferences` 调用（上游 #871 刻意改为「不在新建会话时写全局默认值」，改由 `app/api/models/default/route.ts` + `lib/default-preferences.ts` 显式写入）；删除已被取代的 `lib/startup-preferences.ts`
- `lib/session-ui-state-shared.ts` / `lib/session-ui-state.ts` / `lib/session-ui-state-migrate.ts` / `instrumentation-node.ts`：见第 2 节 G2
- `.next/types` 已删除（旧构建的生成类型，仅供 tsc；下次 `next build` 重建）
- `app/api/files/linked-directory-route.test.mjs`：固定 `PI_WEB_ALLOW_ALL_FILES=false`（本机 `~/.pi/agent/settings.json` 里 `allowAllFiles: true` 会打开本 fork 的 settings 开关，穿透这些边界测试）
- `lib/i18n/messages/{en,zh-CN}.ts`：删除已无代码引用的 3 个本地 key（`sidebar.deleteWithShiftClick` / `expandSubagents` / `collapseSubagents`），zh-TW 与 en 的 key 集合恢复一致

### 4.2 剩余工作（未完成）

**A. 单测 49 项失败**（`npm test`），按文件：

| 文件 | 失败数 | 判断 |
|---|---|---|
| `hooks/useAgentSession.test.mjs` | 11 | 本地测试写在旧 hook 内部结构上（`loadSession` 位置参数、`getCachedSession`），需按合并后的 options 签名与 `loadLiveState` 改写 |
| `components/AppShell.workspace-memory.test.mjs` | 9 | 本地源码断言，需对齐保留窗口架构后的 AppShell |
| `lib/session-reader.test.mjs` | 5 | `allowStale` / `setSessionCatalogLoaderForTesting` 缝合与新 scanner 的对齐 |
| `public/sw.test.mjs` | 4 | 本地 SWR 走 `caches.open`，测试 mock 只提供 `caches.match`；需补 mock 或调整策略 |
| `components/AppShell.sidebar-breakpoint.test.mjs` | 3 | 上游测试针对「上游 AppShell + 新侧边栏」组合 |
| `components/ExtensionStatusBar.test.mjs` | 2 | 我融合后的扩展状态栏 |
| `components/ChatInput.test.mjs` | 2 | 上游 `onAttachFiles` 与本地附件流合并后 |
| `components/AppShell.session-delete.test.mjs` | 2 |  |
| 其余 10 个文件各 1 项 | 10 | `rotate-preview-secrets`、`retry-banner`、`context-usage`、`client-cache-integration`、`SessionTree`、`SessionSidebar`、`PwaRegistration`、`ChatWindow.process-details`、`AppShell.session-windows`、`sessions/detail-route` |

**B. 侧边栏尚未移植的本地能力**（上游基线已有替代，需确认是否仍要回植）：
Flat 视图模式、最近 24 小时筛选、手动刷新会话列表按钮、会话菜单「复制路径」、滑动归档、运行中/未读浮动行位于置顶之下。

**C. 其他**：
- `docs/adr/0006-server-side-session-flags.md` 标记为被上游 `ui-state` 取代
- `docs/local-upgrades-before-upstream-merge.md` 补充能力归属

**D. 验证与上线（未开始）**：`npm run test:terminal`、`npm run test:e2e`、安全双保险显式验证（上游 0.11.0 随机密钥 + 本地 X-Forwarded-Proto）、`PI_WEB_DIST_DIR=.next-build-v0.12.0 npm run build`、30142 蓝绿冒烟、备份替换 `.next` + `pm2 restart pi-web`、`main` 快进与推送

### 4.3 已完成的验证

- `npm install`：已完成（pi `1.1.0`、Next `16.3.8`）
- `node_modules/.bin/tsc --noEmit`：**0 error**
- `npm run lint`：**0 error**，1 warning（既有 `PwaInstallPrompt.tsx` `<img>`）
- `npm test`：2813 pass / 49 fail / 1 skip
- `npm run test:terminal`、`npm run test:e2e`、构建、上线：**未执行**

## 5. 安全提示

> **不要提交当前状态。** 因为中途对已解完的文件执行过 `git add`，`git status` 会误报"冲突已全部解决"。提交前必须先用下面这条命令确认没有残留冲突标记：
>
> ```bash
> grep -rl '^<<<<<<< HEAD' --include=*.ts --include=*.tsx --include=*.mjs . | grep -v node_modules | grep -v '^./.next'
> ```

## 6. 验证结果

| 项 | 结果 |
|---|---|
| `npm install`（pi 1.1.0 / Next 16.3.8） | ✅ |
| `tsc --noEmit` | ✅ 0 error |
| `npm run lint` | ✅ 0 error，1 warning（既有 `<img>`） |
| `npm test` | ⚠️ 2813 pass / 49 fail |
| `npm run test:terminal` | ⬜ |
| `npm run test:e2e` | ⬜ |
| `PI_WEB_DIST_DIR=.next-build-v0.12.0 npm run build` | ⬜ |
| 30142 蓝绿冒烟 | ⬜ |
| 替换 `.next` + `pm2 restart pi-web` | ⬜ |
| `main` 快进 + 推送 | ⬜ |
