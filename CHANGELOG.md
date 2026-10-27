# Changelog

## 0.4.0 — 好词好句训练 · WorkBuddy 接入 · 免费模型

- 已构建 Windows 便携包：`ielts-writing-studio-v0.4.0-windows-x64.zip`（39.7 MB，源提交 `7fcd345`，SHA256 `ad5838974d2e216fbc62d9c77d6f8e72ac42028f5578ff8e60a27f428b701f7b`）。`setup.exe` 安装包依赖 Inno Setup 6，本机未安装，暂未构建。

- 新增「好词好句训练」：批改完成后，用本篇精修稿和范文里真实出现过的表达自动出题，顺序为「原文填空 → 看中文写英文 → 改错回炉」，共 11 题。答完即时判分，接近答案会提示拼写或词形问题；结束后可只重练错题，累计作答数与一次答对率保存在本机。题目完全在本地由已完成的批改结果生成，不额外调用 AI、不产生费用。
- 新增 WorkBuddy CLI 作为 AI 来源：WorkBuddy 桌面版自带 `codebuddy` 命令行，可用本机已登录账号的额度完成批改，不需要 API 密钥。首次使用双击项目里的 `Login WorkBuddy.cmd`，在打开的窗口输入 `/login` 完成一次登录即可；未安装、未登录、端口冲突都会给出对应的处理办法，并在提示里带上当前引擎。
- 修复：桌面版 WorkBuddy 会占住命令行默认端口 51179，导致一旦 WorkBuddy 开着，命令行就报 `EADDRINUSE` 直接退出。现在统一用 `--port 0` 由系统分配端口；登录脚本同样如此，否则连登录界面都打不开。
- 修复：切换到 WorkBuddy 时强制重新探测登录状态，登录完成后不会因为 5 分钟缓存继续显示未登录。
- 命令行调用禁用全部工具（`--tools ""`）、只读结构化输出（`--json-schema`）、使用临时端口，按 Codex 同样的安全边界运行；两个分析任务串行执行，避免本机会话互相争用。
- 在线 AI 预设改为「免费优先」：新增智谱 GLM Flash（当前免费）、腾讯混元 `hunyuan-lite`（免费），豆包、硅基流动、OpenRouter 标注免费额度；服务商按「有免费额度 / 按量付费」分组，默认选中最省钱的选项，并说明仍需自己注册、实名与额度规则以官方为准。
- 修复：`WorkBuddy` 未登录时命令行仍以退出码 0 结束，现改为检查输出内容，不再误判为成功。
- 新增 12 项自动测试：训练题生成、判分、统计，WorkBuddy 命令行参数与错误文案，以及免费预设顺序，全套 170 项通过。

## 0.3.1 — 修复连接失败提示，尚未发布

- 在线 AI 连接失败时显示服务商返回的真实原因和 HTTP 状态码，不再统一显示“AI 接口请求失败，请检查服务地址、模型名称和配置”：
  401 密钥无效、402 余额不足（DeepSeek 会直接指向充值页）、400/422 模型名或参数不被支持、403 权限或未实名、404 地址或模型不存在、429 限流、5xx 服务商故障。
- 上游错误正文做截断和控制字符清理后展示，密钥不会进入任何提示或日志；非 JSON 响应仍然只给通用说明。
- 本地 Ollama 在分析前先核对模型是否真的存在：服务没启动、没有下载任何模型、缺的是哪个模型，都会直接说明，并给出该执行的 `ollama pull 模型名` 命令和已安装模型列表。
- 分析超时或结果不完整时，提示里带上当前使用的 AI 与模型，本地模式额外说明 CPU 推理可能过慢，便于用户判断是换模型还是换网络。
- 在线 AI 弹窗新增“连接失败怎么排查”，按 HTTP 状态码列出常见原因；DeepSeek 预设补充余额与充值说明。
- 新增 4 项自动测试，覆盖 402/400/404/429/503 的错误文案、DeepSeek 充值提示和本地模型缺失/未启动的预检。

## 0.3.0 — 2026-10-01 桌面版

- 修复从 Windows 启动器关闭输出管道时可能出现的 Electron `EPIPE` 主进程错误弹窗。
- 将 Windows 标题栏图标替换为句进自有图标，页面 Logo 与浏览器图标保持一致。
- 移除默认的 File / Edit / View / Window / Help 菜单，改为软件内中文工具栏。
- 将“检查更新”移到顶部工具栏，重新整理 Logo、标题、卡片、按钮和工作区层级。
- 弹窗、在线 AI 设置和更新窗口从触发按钮位置弹性展开，关闭时回到原位置；系统减少动态效果时自动降级。
- Codex CLI 状态检测改为自动查找实际安装路径，并显示当前配置模型；顶部在线状态显示具体服务商和模型名称。
- 保留 Task 1 图片识别和独立桌面窗口能力。

- Task 1 学术类新增 PNG/JPG/WebP 图片导入，通过支持视觉输入的在线模型或本地视觉模型提取图表、流程、地图文字材料。
- 图片识别结果先进入“图表原始信息”框供人工核对；模糊值标记为“待确认”，不直接绕过原有 Task 1 数据校验。
- 新增 Electron 独立桌面窗口测试入口，窗口内部加载本机服务，不要求用户打开浏览器，关闭窗口即可结束桌面程序。
- 当前只提供用户测试包；Windows/Mac 正式桌面安装器和 GitHub Release 等待测试确认。

## 0.2.0 — 2026-09-30

- 增加 Task 1 学术类图表、流程和地图的文字材料批改，以及培训类书信批改；按 TA / CC / LR / GRA 评分，最低字数 150。
- 题型和原图文字材料随草稿、历史记录和学习笔记保存；旧记录继续按 Task 2 读取。
- Task 1 独立范文只接收题目和原图材料，不接收学生作文；本地模型继续采用先写作、后评分的两阶段流程。
- 在线设置新增豆包（火山方舟）与腾讯混元预设、一键打开官方登录/密钥页和中文连接步骤。登录聊天网站不能直接授权第三方应用，需使用官方 API 密钥。
- 提供 Windows 安装版/便携版、Apple Silicon / Intel Mac 便携包，内置官方 Node 运行时。
- Windows 安装版新增手动触发的在线更新：固定仓库、SHA256 校验、安装重启；旧版需手动升级一次。
- 增加 Windows / Linux / macOS 的 Node 22、24 测试矩阵，以及两种 Mac 架构的打包和启动验证流程。Mac 包未签名或公证。
- 修复 Windows 关闭本应用自启的 Ollama 时遗留推理子进程的问题，释放其占用的内存/显存。

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
