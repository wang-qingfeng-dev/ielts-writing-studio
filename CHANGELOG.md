# Changelog

## 0.1.2 — 2026-09-19

改进本地 AI 批改的输出校验与恢复，新增无需下载模型的在线 AI 设置入口。

### Added
- 中文在线 AI 设置：服务商预设、自定义兼容接口、模型与 API 密钥配置，以及不含作文的连接测试。
- 仅在连接测试成功后保存设置并切换服务；支持删除本机连接配置，不改变作文和练习记录。
- 页面说明各服务商的费用和额度边界，使用用户自己的账号与密钥。
- 保存在线配置后恢复所选 AI 模式，继续兼容已有 `.env` 配置。

### Changed and fixed
- Ollama 使用明确的 JSON 结构约束与上下文、输出长度设置；本地任务依次执行，减少同时占用内存。
- 对不完整的正文和四项评分进行有限次数重试；无法生成合格核心结果时保留草稿并说明失败。
- 无法在来源正文中核实的非核心标注会被省略并显示提示，避免一个无效高亮使整篇有效结果丢失。
- 安装后首次页面只提供在线或本地 AI 选择，用户点击后才开始下载模型。
- 新安装默认推荐 `qwen3.5:4b`（模型约 3.4 GB）；自动准备要求至少 12 GiB 内存，建议 16 GB 内存及独立显卡。低于门限引导使用在线 AI，不再自动选择较弱的 3B 模型。
- 旧安装恢复时保留原模型，不强制下载；用户点击「更新推荐本地模型」才开始升级，旧模型文件继续保留。
- 修复本地准备请求失败后重试按钮未解锁，以及启动时本地状态覆盖已保存在线选择的问题。
- 状态栏使用“模型已连接”，区分接口连接与整篇批改质量验证。

### Verification
- 133 项自动测试通过；两篇合成作文通过 Qwen3.5:4b 真实模型批改，并验证浏览器交互。
- Windows 隔离安装验证通过，涵盖中文和空格路径、内置 Node、配置加载及测试进程清理。
- 云端适配通过模拟服务验证，未使用真实云端账户验证作文调用。详见 [版本验证记录](docs/release-verification-v0.1.2.md)。

### Limits
在线服务仍需自己的账号、密钥及可用额度；免费服务的模型、限流和稳定性可能变化。本地推理速度与输出质量取决于硬件和模型，仅使用 CPU 时可能耗时数分钟或超时。自动化测试、连接检查不等于雅思估分准确率验证，AI 估分仍仅供练习参考。

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
