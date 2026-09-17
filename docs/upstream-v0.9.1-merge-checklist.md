# 上游 v0.9.1 合并核对表

## 合并范围

- 集成分支：`codex/merge-upstream-v0.9.1`
- 本地基线：`main@3d66f3d`
- 上游目标：`upstream/main@860698a`
- 本地功能基线：`docs/local-upgrades-before-upstream-merge.md`
- 合并方式：一次 `--no-ff` merge；未 rebase 本地提交，未直接修改 `main`

## 本地能力保留

- [x] 多窗口注册表仍是聊天生命周期唯一来源；后台窗口保留消息、草稿、滚动、流和交互展开状态。
- [x] SSE 继续执行桌面 3、移动 2 的连接预算、30 秒 grace close 和 15 秒运行态校验；lease 只由激活窗口续租。
- [x] 新会话 promotion 保留稳定 `windowId`，草稿 rekey 后再发布真实 session，避免在途流被重挂载打断。
- [x] 服务端 `pinned`、`hidden`、`unread` 偏好及旧 localStorage 迁移接口保留；偏好写入不清空文件元数据缓存。
- [x] 本地增量元数据扫描器、正文缓存和非运行态缓存规则保留；持久化索引升级为含 `size`、`mtimeMs`、`ctimeMs` 的版本 2 格式。
- [x] `alignToTurn` 完整轮次分页、分支上下文、compaction 历史和延迟 thinking/media 请求参数保留。
- [x] `/api/config`、`/api/upload`、`PUT /api/sessions/:id/prefs` 和 `PI_WEB_TOOL_INPUT_FORMAT` YAML 展示保留。
- [x] `PI_WEB_ALLOW_ALL_FILES`、路径允许根与文件引用授权共同保留；默认关闭时继续拒绝越界路径。
- [x] 项目/Flat 两种侧栏模式、24 小时筛选、置顶/隐藏/未读、滑动隐藏、pending 行和层级树保留。
- [x] `$` 技能补全、通用文件上传、项目/分支选择、YAML 工具参数、图片缩略图、修改文件卡片和 Panel 全屏保留。
- [x] 顶栏主题、语言、Web Push、PWA 安装与角标入口保留；设置页与顶栏共用同一主题状态。

## 上游能力引入

- [x] 升级到 Pi `0.85.1`、Next.js `16.3.5` 和 Pi Web `0.9.1` 依赖体系，加入 Playwright、semver、终端原生依赖与 postinstall。
- [x] 引入终端 API、终端标签和真实 PTY 重连/重启/工作区隔离流程；文件标签与终端标签可共存。
- [x] 引入会话全文搜索与消息定位、引用选区创建新会话、阅读位置持久化和聊天外观设置。
- [x] 引入 gzip JSON 响应、Pi 0.85.1 上下文适配、延迟媒体/思考内容加载、视频预览和大文本分页。
- [x] 引入 agent lease、子代理队列/恢复、worktree 隔离、扩展 UI/工具、可配置 idle timeout 和活动工具进度。
- [x] 引入 Web 密码登录、provider usage、插件检查/更新、技能检查/更新和模型同步。
- [x] 引入安全 URL transform、localhost 链接替换、图片能力警告、紧凑输入模式和内置命令防重。
- [x] 补齐 PWA 角标依赖的 `/api/agent/running/events` SSE：立即快照、变化推送、心跳和取消清理。

## 虚拟会话树

- [x] 展开后的会话树扁平为 `{ node, depth, hasChildren }`，采用迭代遍历避免深树调用栈风险。
- [x] 固定行高 54px、overscan 8；折叠状态由 sidebar 级 `Set` 管理。
- [x] 焦点行和重命名、菜单、删除、滑动交互行强制保留挂载。
- [x] “显示更早”位于虚拟滚动区域外；项目和 Flat 模式继续复用 `SessionItem`。

## 刻意行为变化

- 删除普通会话时，普通 fork 仍重挂父级；属于该会话的全部子代理后代改为一并删除，并清理每个删除 id 的偏好、路径缓存和正文缓存。
- 已挂载窗口重新激活时，会把最新尾部与已分页历史按共同祖先合并；不会因 30 秒客户端缓存过期而丢失已加载历史。
- 常驻窗口切换后保留“过程详情”等局部展开状态，而不是沿用上游单窗口 remount 后自动折叠的副作用。
- E2E 子进程显式关闭 `PI_WEB_ALLOW_ALL_FILES` 和兼容旧开关，保证安全边界测试不受本机 `.env.local` 影响。
- 多终端关闭测试改为等待面板数量归零，避免 Playwright strict locator 在两个合法面板并存时提前失败。

## 验证结果

- [x] `node_modules/.bin/tsc --noEmit`：通过。
- [x] `npm run lint`：0 error；仅保留合并前已有的 `PwaInstallPrompt.tsx` `<img>` 警告，无新增警告。
- [x] `npm test`：1182/1182 通过。
- [x] `npm run test:terminal`：1440x900 与 390x844 均通过。
- [x] `npm run test:e2e`：1280 与 390 视口均通过，控制台无错误。
- [x] `PI_WEB_DIST_DIR=.next-build npm run build`：成功；仅有既有导出路由动态依赖 webpack 警告。
- [x] 会话索引覆盖冷启动复用、损坏索引重建、同大小/同 mtime 但 ctime 变化的重解析。
- [x] 删除子代理后代测试覆盖父、子、孙会话偏好同步清理。
- [x] 千级树、折叠、固定焦点/交互行、Flat/最近与更早、滑动和置顶行为由组件测试覆盖。
- [x] 分页、gzip、安全路径、终端/文件标签共存、阅读位置、分支取消、外观和扩展对话框由浏览器测试覆盖。

## 交付状态

- [x] 本次只生成集成分支与 merge commit，不部署、不重启 PM2。
- [x] 现有生产 `.next` 保持原构建并已验证首页及静态资源返回 200。
- [ ] 后续部署前等待 `/api/agent/running` 为空，再使用现有部署脚本完成隔离构建切换、健康检查与失败回滚。
