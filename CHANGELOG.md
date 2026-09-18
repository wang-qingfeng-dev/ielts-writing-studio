# Changelog

## 0.1.1 — 2026-09-18

### Included
- Windows x64 一键安装程序，内置 Node.js 和中文安装向导。
- 一键准备本地 AI：自动下载并校验 Ollama，启动隔离的本机服务，下载 Qwen2.5 模型并执行真实 JSON 检查。
- 首次设置页显示下载阶段、进度、模型、内存和磁盘要求，支持取消、重试和刷新恢复。
- 本地 AI 管理器只绑定 `127.0.0.1:11435`，不会把模型或 API key 写进公开项目。
- 安装后自动打开首次设置页；日常使用桌面快捷方式即可启动。

### Limits
一键准备目前支持 Windows x64；首次需要联网下载几个 GB。AI 估分仍是学习参考，不是雅思官方成绩。项目不提供无限免费的公共在线推理服务。

## 0.1.0 — 2026-09-17

First public release of IELTS Writing Studio (句进).

### Included
- Three-panel Task 2 workspace with linked source annotations and minimal corrections.
- Independent model-essay generation, four-criterion AI estimates and three practice priorities.
- Review cards, spaced repetition, browser-local exercise history and Markdown export.
- Ollama, OpenAI-compatible API and optional Codex CLI adapters.
- English/Chinese documentation, MIT licensing and Node 22/24 CI.

### Fixed for this release
- Compatible APIs now receive the full output schema in their instructions.
- Codex requires explicit selection instead of being an automatic fallback.
- Separate local/API model settings and a four-option provider selector.
- Friendly configuration errors, switch timeout recovery and analysis locking.
- Prompt-only drafts retained in history; keyboard state and narrow-screen controls improved.
- Windows startup and npm start load .env configuration; the launcher respects PORT.
- Whole-request HTTP deadlines for slower providers and the optional live check, with cancellation and response-size limits.
- Updated and pinned CI actions to remove deprecated runtime warnings.

### Limits
AI estimates are not official results. Local model quality and speed vary. The release is a single-user local app; it does not include hosted inference, Task 1 or cloud sync.
