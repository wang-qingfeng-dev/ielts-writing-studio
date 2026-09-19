# 句进 · 雅思写作工作台

[English](README.en.md) · [下载 v0.1.2](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/tag/v0.1.2) · [更新记录](CHANGELOG.md)

**v0.1.2** 新增网页在线 AI 设置，改进本地模型输出校验与恢复，并支持按需准备 Qwen3.5:4b。低配置电脑可选择在线 AI，无需下载本地模型。

一个面向中文学习者的 IELTS Writing Task 2 本机学习工具。通过「我的原文 → 保留原意的精修 → 独立范文」三栏对照，把批改转化成可以复习、造句和迁移的学习卡片。

**四项分数是 AI 练习估分，不是雅思官方成绩。**

![内置教学示例的桌面界面](docs/images/studio-desktop.jpg)

## 可以做什么

- 粘贴完整题目和英文作文，设置目标分数，查看字数。
- 原文与精修联动高亮：原句、修改、中文解释、同类练习。
- 分别查看 TR 任务回应、CC 连贯与衔接、LR 词汇资源、GRA 语法四项估分、证据和改进动作。
- 独立范文只接收题目与目标分，不接收你的作文；真实练习默认折叠范文。
- 每篇优先解决三个问题，并整理错误、搭配、好句与论证方法。
- 收藏后按 1、3、7、14、30 天复习，保存最多 30 篇练习，导出 Markdown 学习笔记。
- 右上角选择「自动 / Ollama 本地 / 在线 AI / Codex CLI」，分析或连接测试中禁止切换。
- 网页提供在线 AI 设置：选择服务商、输入自己的密钥，测试成功后保存；无需编辑配置文件或下载本地模型。
- 正文与四项评分必须通过完整性检查；无法核实的高亮会省略并明确提示，失败或取消会保留原稿和之前完成的结果。

## 第一次使用

### Windows：下载便携版

1. 下载 [句进 v0.1.2 Windows x64 便携版 ZIP](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.2/ielts-writing-studio-v0.1.2-windows-x64.zip)。
2. **先完整解压**到一个文件夹，不要在压缩包里直接运行。
3. 双击解压目录中的 `Start Portable.cmd`，打开本机网页。

便携版已附带 Node.js，无需单独安装 Node。**不包含 AI 模型**：打开后可以立即体验标明为示例的完整教学内容；批改自己的作文还需要配置下方任意一种 AI 服务。此下载包适用于 Windows x64。

### Windows：小白一键安装（推荐）

下载 [句进 v0.1.2 一键安装程序](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.2/ielts-writing-studio-v0.1.2-windows-x64-setup.exe)，双击后按中文向导完成安装。安装程序自带 Node.js，不需要打开命令行。

首次启动先提供在线与本地两种选择，不会自动下载模型。只有点击「一键准备本地 AI」，才会下载并校验 Ollama、准备推荐模型 `qwen3.5:4b`（模型约 3.4 GB）并显示进度。Ollama 运行时另需下载和存储空间，完整准备所需空间以页面提示为准；完成后可以离线使用。

自动准备要求本机可识别总内存至少 12 GiB，建议配备 16 GB 内存和独立显卡；低于门限会提示使用在线 AI，不会自动改装较弱的 3B 模型。仅使用 CPU 时，整篇批改可能需要数分钟甚至超时。准备过程支持重试与取消，不需要输入命令。模型连接检查不等于雅思评分准确率验证。

升级应用后，原来已安装的模型可继续恢复使用，不会强制下载新模型。点击「更新推荐本地模型」才会准备新的推荐模型，旧模型文件会保留。

### 无需下载模型：设置在线 AI

1. 点击页面中的「设置在线 AI」，选择服务商。
2. 点击服务商链接，使用自己的账号创建 API 密钥，再粘贴到设置中；按服务商要求填写可用模型名称。
3. 确认题目与作文发送、账户额度说明，点击「连接并使用」。程序先发送一条不含作文的测试请求，成功后才保存并切换服务。
4. 回到写作区点击「开始分析」。以后启动会恢复已保存的配置；可在「管理在线 AI」中修改或删除连接。

预设提供 DeepSeek、硅基流动、OpenRouter，以及自定义兼容接口。DeepSeek 按用量收费；硅基流动的模型和免费额度以控制台为准；OpenRouter 免费模型需要自己的密钥，并受次数、频率、可用性和输出质量限制。软件不提供共享密钥或无限免费额度。

在线批改不依赖本机运行大模型，但仍需要网络和服务商可用额度。连接测试只验证接口能返回基本格式，不保证每篇批改都会成功。自定义接口只接受 HTTPS；本机 localhost、127.0.0.1、::1 可使用 HTTP，并可按服务要求留空密钥。

### 从源码运行（Windows / macOS / Linux）

1. 安装 [Node.js 24 LTS](https://nodejs.org/)（最低 22.9）。
2. 从 Release 下载 **Source code (zip)** 并解压，或克隆仓库。
3. Windows 双击 `Start Writing Studio.cmd`；也可以在项目目录运行 `npm start`。
4. 打开 [http://127.0.0.1:4318](http://127.0.0.1:4318)。

源码包不附带 Node，需按上述要求自行安装。项目没有第三方运行时依赖，不需要执行 `npm install`。没有 npm 时可运行 `node --env-file-if-exists=.env server.mjs`。未连接模型也能查看有明确标记的完整示例。

### 免费本地模型

安装并启动 [Ollama](https://ollama.com/)，执行：

```sh
ollama pull qwen3.5:4b
```

在网页选择「Ollama 本地」。无需 API key 或在线模型订阅，但需要电脑提供算力和内存；小模型可能较慢或无法稳定生成合格的批改结果。默认模型仅是起点，本项目没有验证其雅思估分准确率。

### 配置不同模型

将 `.env.example` 复制为 `.env`，按需修改，随后重启服务：

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:4b
# 可选的兼容 API
# AI_BASE_URL=https://your-provider.example/v1
# OPENAI_MODEL=your-provider-model-name
# AI_API_KEY=your-server-side-key
```

若使用兼容 API，将 `AI_PROVIDER` 改为 `openai-compatible`，取消相关配置行前的 `#`，并填写所用服务的地址、模型名和密钥。本机兼容服务可能不要求密钥；在线服务是否收费、是否提供免费额度由服务商决定。

`npm start` 和 Windows 启动器都会加载 `.env`；已有的系统/终端环境变量优先于 `.env`。网页中保存的在线地址、模型和密钥优先用于在线模式，已有 `.env` 兼容接口仍可通过下拉菜单选择。Ollama 和兼容接口的模型分别配置；`AI_MODEL` 保留为旧配置的后备值。

Codex 模式需要你自己安装、登录 CLI，使用你自己的账号额度。自动模式优先检查 Ollama，再使用你明确配置的 API，**不会自动转到 Codex**。已保存网页在线配置时，下拉选择会一并保存，重启后恢复；未保存时，下拉选择仅在本次服务进程中生效，重启后按环境配置选择。

## 数据与使用边界

草稿、练习和卡片保存在当前浏览器本机存储，不加密、不跨设备同步。清理浏览器数据或更换地址/端口可能导致看不到旧记录，请先导出笔记。

提交分析时，题目与作文会发送给所选服务。默认本机 Ollama 推理留在电脑上；外部 API、远程 Ollama 地址和 Codex 会涉及相应服务。

网页设置中的密钥保存在当前用户的应用配置目录；Windows 路径为 `%LOCALAPPDATA%\JujinWritingStudio\settings\cloud-ai.json`。此文件不加密，不写入浏览器练习记录或项目仓库，请勿分享配置文件或在共享电脑上保存自己的密钥。页面不会回传已保存的密钥。删除已保存连接会删除该配置文件，作文记录继续保留；通过 `.env` 配置的凭据需自行从 `.env` 移除。

当前版本只支持 Task 2；不包含云同步、多人账号、Task 1 或软件提供的公共推理服务。公开源码和 GitHub Release 不等于部署了可直接在线批改的网站。当前服务器只监听本机地址，请勿直接当成公网多人服务部署。

## 测试与贡献

```sh
node --test tests/*.test.mjs
```

v0.1.2 通过 133 项自动测试、两篇 Qwen3.5:4b 真实模型批改和 Windows 隔离安装测试，详见 [版本验证记录](docs/release-verification-v0.1.2.md)。在线适配使用模拟服务验证，尚未验证真实云端账户的作文调用。项目配置 GitHub Actions 在 Node 22、24 上运行测试；`tests/live-check.mjs` 是可选真实模型检查，会使用当前服务的算力或额度。上述检查不能证明雅思估分准确率或每篇作文都能成功。

欢迎提交问题和修复，报告时说明系统、Node 版本、所用 AI 类型和复现步骤；不要附真实 API key 或不愿公开的作文。

## 许可证

采用 [MIT](LICENSE)。模型、外部服务和 IELTS 官方资料遵循各自条款，见 [第三方说明](THIRD_PARTY_NOTICES.md)。[官方评分说明](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)仅作为维度参考。
