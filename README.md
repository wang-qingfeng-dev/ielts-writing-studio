# 句进 · 雅思写作工作台

[English](README.en.md) · [下载 v0.1.1](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/tag/v0.1.1) · [更新记录](CHANGELOG.md)

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
- 右上角选择「自动 / Ollama 本地 / 兼容 API / Codex CLI」，分析中禁止切换。

## 第一次使用

### Windows：下载便携版

1. 下载 [句进 v0.1.0 Windows x64 便携版 ZIP](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.0/ielts-writing-studio-v0.1.0-windows-x64.zip)。
2. **先完整解压**到一个文件夹，不要在压缩包里直接运行。
3. 双击解压目录中的 `Start Portable.cmd`，打开本机网页。

便携版已附带 Node.js，无需单独安装 Node。**不包含 AI 模型**：打开后可以立即体验标明为示例的完整教学内容；批改自己的作文还需要配置下方任意一种 AI 服务。此下载包适用于 Windows x64。

### Windows：小白一键安装（推荐）

下载 [句进 v0.1.1 一键安装程序](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.1/ielts-writing-studio-v0.1.1-windows-x64-setup.exe)，双击后按中文向导完成安装。安装程序自带 Node.js，不需要打开命令行；安装结束会自动打开「一键准备本地 AI」页面。

点击页面中的按钮后，程序会自动下载并校验 Ollama，准备 Qwen2.5 本地模型，显示进度并进行连接检查。完成一次后，日常只需要从桌面快捷方式启动。首次准备需要联网下载几个 GB，之后可以离线使用；模型保存在自己的电脑上，不会把作文发送到陌生的公共接口。

本地模型需要电脑有足够内存和磁盘空间。安装包会根据电脑内存选择合适的模型；如果准备失败，页面提供重试和取消按钮，不需要手动输入命令。AI 估分仍然只是学习参考，不是雅思官方成绩。

### 从源码运行（Windows / macOS / Linux）

1. 安装 [Node.js 24 LTS](https://nodejs.org/)（最低 22.9）。
2. 从 Release 下载 **Source code (zip)** 并解压，或克隆仓库。
3. Windows 双击 `Start Writing Studio.cmd`；也可以在项目目录运行 `npm start`。
4. 打开 [http://127.0.0.1:4318](http://127.0.0.1:4318)。

源码包不附带 Node，需按上述要求自行安装。项目没有第三方运行时依赖，不需要执行 `npm install`。没有 npm 时可运行 `node --env-file-if-exists=.env server.mjs`。未连接模型也能查看有明确标记的完整示例。

### 免费本地模型

安装并启动 [Ollama](https://ollama.com/)，执行：

```sh
ollama pull qwen2.5:7b
```

在网页选择「Ollama 本地」。无需 API key 或在线模型订阅，但需要电脑提供算力和内存；小模型可能较慢或无法稳定生成合格的批改结果。默认模型仅是起点，本项目没有验证其雅思估分准确率。

### 配置不同模型

将 `.env.example` 复制为 `.env`，按需修改，随后重启服务：

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b
# 可选的兼容 API
# AI_BASE_URL=https://your-provider.example/v1
# OPENAI_MODEL=your-provider-model-name
# AI_API_KEY=your-server-side-key
```

若使用兼容 API，将 `AI_PROVIDER` 改为 `openai-compatible`，取消相关配置行前的 `#`，并填写所用服务的地址、模型名和密钥。本机兼容服务可能不要求密钥；在线服务是否收费、是否提供免费额度由服务商决定。

`npm start` 和 Windows 启动器都会加载 `.env`；已有的系统/终端环境变量优先。Ollama 和兼容接口的模型可以分别配置，避免切换后使用错误的模型名。`AI_MODEL` 保留为旧配置的后备值。

Codex 模式需要你自己安装、登录 CLI，使用你自己的账号额度。自动模式优先检查 Ollama，再使用你明确配置的 API，**不会自动转到 Codex**。下拉选择只在本次服务进程生效，重启后恢复环境配置。

## 数据与使用边界

草稿、练习和卡片保存在当前浏览器本机存储，不加密、不跨设备同步。清理浏览器数据或更换地址/端口可能导致看不到旧记录，请先导出笔记。

提交分析时，题目与作文会发送给所选服务。默认本机 Ollama 推理留在电脑上；外部 API、远程 Ollama 地址和 Codex 会涉及相应服务。密钥只放服务端 `.env`，不要写到网页代码中。

v0.1.1 只支持 Task 2；不包含云同步、多人账号、Task 1 或在线免费推理服务。公开源码和 GitHub Release 不等于部署了可直接在线批改的网站。当前服务器只监听本机地址，请勿直接当成公网多人服务部署。

## 测试与贡献

```sh
node --test tests/*.test.mjs
```

v0.1.1 已通过自动化测试，GitHub Actions 在 Node 22、24 上运行测试。`tests/live-check.mjs` 是可选真实模型检查，会使用当前服务的算力或额度；模拟接口测试不能证明实际模型评分质量。

欢迎提交问题和修复，报告时说明系统、Node 版本、所用 AI 类型和复现步骤；不要附真实 API key 或不愿公开的作文。

## 许可证

采用 [MIT](LICENSE)。模型、外部服务和 IELTS 官方资料遵循各自条款，见 [第三方说明](THIRD_PARTY_NOTICES.md)。[官方评分说明](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)仅作为维度参考。
