# 上游 v0.15.0 合并核对表

> 状态：**只做试合并，只产出冲突清单与建议**。未解决任何冲突，未构建，未跑测试。
> 试合并结果已记录，工作区已还原干净。重跑命令见第 6 节。

## 1. 合并范围

- 集成分支：`codex/merge-upstream-v0.15.0`。
- 分支起点：`codex/merge-upstream-v0.12.0@9b8f4db`。
- 合并前 WIP 存档提交：`d7aa639`。
- 上游目标：`v0.15.0`，即 `f130910`。
- 共同祖先：`894e1a2`，即 `v0.12.0`。
- 本地领先共同祖先 57 个提交。
- 上游领先共同祖先 206 个提交。
- 上游改动 451 个文件，`+36,697 / -4,226` 行。
- 试合并产生 29 个未合并路径。
- 未合并路径构成：26 个 `content`、2 个 `add/add`、1 个 `modify/delete`。
- 自动合并成功：292 个修改、122 个新增、4 个重命名、4 个删除。

### WIP 存档内容

`d7aa639` 保存了合并前未提交的本地改动。

- 新增 SVG 代码块预览：`components/SvgBlock.tsx`、`lib/svg-preview.ts` 及其单测。
- 新增 `lib/startup-preferences.ts`，当前无引用，属未完成草稿。
- 修改 i18n 三份文案、`MarkdownBody`、`MermaidBlock`、`FileViewer`、`globals.css`。
- 修改 `ecosystem.config.cjs`、`tsconfig.json`、`docs/agents/sessions.md`、`docs/local-upgrades-before-upstream-merge.md`。
- 修改 `.agents/skills/ask-user/SKILL.md`。

## 2. 冲突清单

按冲突行数降序排列。冲突块是 `<<<<<<<` 标记的数量。

### A. 聊天与侧边栏主链路（最重）

| 文件 | 冲突块 | 冲突行 | 类型 | 争议内容 |
|---|---:|---:|---|---|
| `components/AppShell.tsx` | 23 | 604 | content | 本地窗口注册表、Flat 视图、草稿与句柄管理；上游侧边会话、分组间隔、Agents 面板 |
| `hooks/useAgentSession.ts` | 9 | 177 | content | 本地 SSE 预算与窗口活跃判断；上游 `markPromptLanded`、模型数据缓存字段 |
| `components/MessageView.tsx` | 8 | 167 | content | 本地上游均改 Props：`askUserMode`、时间戳、耗时、usage |
| `components/SessionSidebar.tsx` | 6 | 72 | content | 本地 Flat 与置顶浮动；上游归档折叠与批量操作 |
| `components/ChatWindow.tsx` | 4 | 69 | content | 本地 `windowId`/`isActive` 常驻窗口；上游新 Props 与侧边会话 |
| `components/MarkdownBody.tsx` | 6 | 65 | content | 本地 `localhost` 重写与 `keepLineBreaks`；上游文档阅读器与音视频 |
| `components/MermaidBlock.tsx` | 4 | 44 | content | 本地预览按钮改造；上游语法高亮与共享预览组件 |
| `components/FileViewer.tsx` | 2 | 83 | content | 本地面板级全屏按钮；上游文件分栏与换行 |
| `components/ChatInput.tsx` | 1 | 5 | content | 本地上传中禁用入队；上游叠层输入栏布局 |

### B. 会话数据与侧边栏模型

| 文件 | 冲突块 | 冲突行 | 类型 | 争议内容 |
|---|---:|---:|---|---|
| `components/AppShell.workspace-memory.test.mjs` | 3 | 461 | content | 上游整篇重写该测试 |
| `app/api/sessions/[id]/route.ts` | 3 | 65 | content | 本地正文缓存与 `alignToTurn`；上游 `projectTree`、侧边会话、统计 |
| `lib/session-tree.ts` | 3 | 49 | content | 本地 `flat`/`floating`/`flat-older`；上游 `awaiting`、`spacer`、归档折叠 |
| `lib/session-list-scanner.ts` | 1 | 9 | content | 索引格式版本与节流常量 |
| `lib/session-list-scanner.bench.mjs` | - | - | modify/delete | 本地已删除，上游仍改 |
| `lib/rpc-manager.ts` | 1 | 8 | content | 本地自动标题触发点；上游 `session_info_changed` 失效逻辑 |

### C. 重复功能与文案

| 文件 | 冲突块 | 冲突行 | 类型 | 争议内容 |
|---|---:|---:|---|---|
| `components/SvgBlock.tsx` | 1 | 237 | add/add | 本地与上游各自实现 SVG 预览 |
| `components/SvgBlock.test.mjs` | 1 | 225 | add/add | 两份测试同时新增 |
| `lib/i18n/messages/en.ts` | 4 | 39 | content | 双方新增键位并插入同处 |
| `lib/i18n/messages/zh-CN.ts` | 4 | 39 | content | 同上 |
| `lib/i18n/messages/zh-TW.ts` | 2 | 13 | content | 同上 |
| `hooks/retry-banner.test.mjs` | 1 | 4 | content | 上游新增 `markPromptLanded` 桩 |

### D. 构建与文档

| 文件 | 冲突块 | 冲突行 | 类型 | 争议内容 |
|---|---:|---:|---|---|
| `package.json` | 1 | 4 | content | 本地 `lucide-react` 与上游 `next 16.4.4` |
| `package-lock.json` | 1 | 4 | content | 同上 |
| `AGENTS.md` | 1 | 30 | content | 上游重写结构，本地有 Local Fork Notes |
| `README.md` | 1 | 4 | content | 本地环境变量与上游新章节 |
| `docs/agents/files-and-access.md` | 1 | 23 | content | 本地允许列表说明与上游新条目 |
| `docs/agents/sessions.md` | 2 | 9 | content | 本地未读持久化与上游每浏览器记录 |
| `docs/agents/client-platform.md` | 1 | 8 | content | 双方新增段落位置冲突 |
| `docs/agents/subagents.md` | 1 | 4 | content | 上游改用 `AgentSessionPanel` |

## 3. 自动合并成功但必须复查

这些路径没有冲突标记，但合并结果可能语义错误。

| 路径 | 复查原因 |
|---|---|
| `components/SubagentViewer.tsx`、`components/subagent-viewer-state.ts`、`components/ThemeIcon.tsx` | 上游已删除，替换为 `components/AgentSessionPanel.tsx`。本地子代理查看器依赖旧组件 |
| `lib/file-access.ts`、`app/api/files/[...path]/route.ts`、`bin/pi-web-options.js` | 本地 `PI_WEB_ALLOW_ALL_FILES` 开关已在合并树中存在，需补跑安全用例 |
| `next.config.ts`、`eslint.config.mjs`、`public/sw.js` | 本地 `PI_WEB_DIST_DIR`、缓存策略与上游新逻辑需要在同一文件内对齐 |
| `bin/pi-web.js` | 上游 CLI 结构与本地开关参数需人工确认 |
| `app/api/agent/[id]/lease/route.ts`、新增 `app/api/agent/debug/route.ts` | 上游新增租约与调试端点，本地 `rpc-manager` 必须提供对应状态 |
| `lib/sidebar-prefs.ts`、`lib/sidebar-actions.ts` | 上游新增归档折叠与批量操作，本地的 Flat 与置顶行为需回贴 |
| `app/manifest.ts` → `app/manifest.webmanifest/route.ts` | 上游重命名，PWA 安装入口需复核 |
| `README.ja.md`、`README.ru.md`、`README.zh-CN.md` → `docs/` | 上游移动文档，本地下载链接与版本号说明需跟随 |

## 4. 合并建议

原则：以上游为基线，把本地能力逐条回贴。不要做“保留两边”的机械合并。

理由：上游重写了 `lib/rpc-manager.ts`、`lib/session-list-scanner.ts`、`components/AppShell.tsx`。机械合并会留下互不兼容的两套数据流。

### 批次 0：依赖与构建

- 采用上游 `package.json` 依赖版本。
- 保留本地 `lucide-react`。
- 新增依赖：`@earendil-works/pi-codemode`、`pi-mcp`、`pi-schema`、`pi-telemetry`、`typebox`。
- 升级 `next` 到 `16.4.4`。
- 重新生成 `package-lock.json`，不要手工编辑。
- 门禁：`npm ci` 成功，`tsc --noEmit` 0 error。
- 未过门禁前，不要动业务文件。

### 批次 1：文档与文案

- `AGENTS.md` 取上游结构，把 Local Fork Notes 整段追加到末尾。
- `README.md` 取上游，补回 `PI_WEB_ALLOW_ALL_FILES`、`PI_WEB_TOOL_INPUT_FORMAT`、`PI_WEB_DIST_DIR`。
- `docs/agents/*.md` 以上游为基线，回贴本地段落。
- i18n 三份文案取键位并集，本地独有键保留。

### 批次 2：会话数据层

- `lib/session-list-scanner.ts` 以上游为准，再回贴本地的索引格式版本与计数规则。
- `lib/session-list-scanner.bench.mjs` 保持删除。
- `lib/session-tree.ts` 以上游为准，回贴 `flat`、`floating`、`flat-older`。
- `app/api/sessions/[id]/route.ts` 以上游为准，回贴本地正文缓存与 `alignToTurn`。

说明：上游 `#1264` 已实现“只续扫文件尾部”，与本地的增量扫描目标相同。保留上游实现即可，不必维护两套索引。

### 批次 3：聊天与侧边栏 UI

按依赖顺序处理，每完成一个文件立即跑对应单测。

1. `lib/rpc-manager.ts`：先解决标题与事件失效点。
2. `hooks/useAgentSession.ts`：补 `markPromptLanded`，保留 SSE 预算。
3. `components/ChatWindow.tsx`：保留 `windowId`/`isActive`，接上游新 Props。
4. `components/MessageView.tsx`、`components/MarkdownBody.tsx`、`components/MermaidBlock.tsx`、`components/ChatInput.tsx`、`components/FileViewer.tsx`。
5. `components/SessionSidebar.tsx`。
6. `components/AppShell.tsx`：最后合并，它同时依赖以上全部改动。

### 批次 4：清理与验证

- 删除本地 `components/SvgBlock.tsx` 与 `lib/svg-preview.ts`，改用上游版本。
- 上游版本共用 Mermaid 的缩放弹窗，功能更全。
- 本地子代理查看器改挂 `components/AgentSessionPanel.tsx`。
- 删除或补齐无引用的 `lib/startup-preferences.ts`。
- 定向验证：`tsc --noEmit`、`npm run lint`、相关目录单测。
- 生产构建输出到 `.next-build-*`，不要覆盖运行中的 `.next`。

## 5. 风险与待确认

- 不确定 pi `1.5.0` 是否改了 `rpc-manager`、MCP、codemode 的接口。需要逐文件核对 SDK 导出。
- 不确定上游 `AgentSessionPanel` 能否承接本地常驻窗口模型。它面向侧边会话，本地面向窗口注册表。
- 不确定上游侧边会话与本地 `lib/session-windows.ts`、`lib/tab-session.ts` 是否重复建模。
- 本地未读状态存在服务端，上游存在浏览器 `localStorage`。两边语义不同，需先定谁是权威。
- 本地 `PI_WEB_ALLOW_ALL_FILES` 默认关闭。合并后必须重跑安全用例，避免上游路径漏检。

## 6. 重跑与复核命令

```bash
git switch codex/merge-upstream-v0.15.0
git merge --no-commit --no-ff v0.15.0
git diff --name-only --diff-filter=U
git merge --abort   # 只做统计时
```

本轮复核用过的命令：

- `git merge-tree --write-tree --name-only HEAD v0.15.0`：文件级冲突预演。
- `git merge --no-commit --no-ff v0.15.0`：真实冲突统计。
- `grep -c '^<<<<<<<' <文件>`：单文件冲突块计数。
- `grep -c isFileSecurityDisabled lib/file-access.ts app/api/files/[...path]/route.ts`：本地开关存活检查。

## 7. 当前进度（第一轮落地）

状态：冲突已全部消除，`tsc --noEmit` 0 error，`npm run lint` 0 error，尚未部署。

### 已完成的取舍

| 范围 | 决定 |
|---|---|
| 依赖 | 采用上游 `1.5.0` / `next 16.4.4`，保留 `lucide-react`，重装依赖并通过 |
| 文档、i18n | 取上游为基线，回贴本地段落与键位；三份文案键位对齐 1813 个 |
| 会话扫描 | 采用上游 `lib/session-list-scanner.ts`，删除本地 bench |
| 会话树 | 采用上游模型，回贴 Flat 视图、浮动行、`flat-older` |
| 会话路由 | 保留本地正文缓存与 `alignToTurn`，补上游 side 关系、缓存费用提示、改名与删除逻辑 |
| SVG 预览 | 删除本地实现，采用上游 `SvgBlock` |
| Mermaid 卡片 | 采用上游，含 `PreviewToggleButton` 等共享组件 |
| 聊天与主壳 | 保留本地实现：常驻窗口、Flat 侧栏、上传、ask-user、时间戳 |
| 子代理查看器 | 恢复本地只读查看器，继续使用 `AgentSessionPanel` 的状态图标 |
| 侧边会话面板 | 暂不接入：删除 `components/SessionChatPanel.tsx` |

### 为兼容而改的接口

- `agentPanel` 的四个新属性改为可选：`openSubagentTabIds`、`onToggleSubagentTab`、`onNewSideChat`、`onDeleteSideChat`。
- `buildQuotedSelection()` 保留一个参数的调用形式，同时接受本地的 `intro` 与 `question`。
- `MarkdownBody` 新增可选 `onNavigateLink`；`SessionTree` 的 `onPinEmptyGroup` 由侧栏实现。

### 第二轮进展

- 采用上游 `MarkdownBody`，回贴本地 ask-user 表单、`localhost` 链接重写、内联代码链接化。
- `CodeBlock` 复制按钮补回 `aria-label` 与图标；预览按钮改为图标加文字，同时满足两侧单测。
- `components/MarkdownBody.test.mjs`、`MermaidBlock.test.mjs`、`SvgBlock.test.mjs` 全部通过。
- 调整两处本地断言以匹配上游设计：SVG 预览等待浏览器解析；SVG 测试只校验围栏自身的标记。
- 失败数：104 → 91。

### 第三轮进展

- 采用上游 `MessageView`，回贴本地的 ask-user 传参链、`alwaysShowCopy`、
  `getToolCallInputText()` 的 YAML 形参、`read` 工具图片缩略图。
- `MessageView` 的用量展示改用上游 TUI 风格统计行，删除本地重复的 `.message-usage` 块。
- ask-user 测试夹具补上 `description`，与本地解析规则一致。
- `components/MessageView.test.mjs` 全部通过。
- 失败数：91 → 74。

### 第四轮进展（components 层）

- `FileViewer`：补 `binary` 字段与 `isBinary` 守卫，补 diff 换行、行号 gutter 钉住、超大文件轻量行。
- `FileViewer.test.mjs`、`test-imports.test.mjs`、`ChatWindow.quote-caret.test.mjs` 全绿。
- 引用插入改名 `quoteSelectionHere`，并按上游 #1319 去掉 `removeAllRanges()`。
- 未读跨标签同步测试标记跳过：本地把未读存在服务端，没有该 localStorage 处理器。
- 失败数：74 → 68；`components/**` 由 26 降到 20。

### 待完成（第五轮：AppShell 层）

剩余 `components/**` 失败全部依赖上游 AppShell 的界面能力，尚未接入。

| 测试文件 | 失败 | 依赖的上游能力 |
|---|---:|---|
| `AppShell.workspace-memory.test.mjs` | 10 | 工作区恢复改走 `openSessionWindowFor`，与本地窗口注册表结构不同 |
| `DebugPanel.test.mjs` | 5 | Debug 按钮、面板焦点归还、运行轮询记账、手机 More 覆盖层 |
| `AppShell.favicon-badge.test.mjs` | 3 | 标签页隐藏期间完成的会话计入 favicon |
| `AppShell.side-tabs.test.mjs` | 1 | 侧标签随主会话恢复，依赖侧边会话 |
| `SessionSidebar.test.mjs` | 1 | 同 favicon 计数 |


- `components/AppShell.workspace-memory.test.mjs`：10 项。
- `components/AppShell.side-tabs.test.mjs`：1 项。
  侧标签随主会话恢复，依赖侧边会话。
- 其余失败集中在 `hooks/`：流释放、用量轮询、草稿回填、`/compact` 分离执行。

### 未接入的上游能力

- 侧边会话 `/side` 与侧标签。
- 标签页 favicon 徽标。
- 归档按项目折叠与批量操作。
- 手机端设置逐层导航。
- 调试面板。

### 复核命令

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```
