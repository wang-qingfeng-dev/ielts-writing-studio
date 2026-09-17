# v0.1.0 · 句进雅思写作工作台

这是首个公开版本，面向中文学习者提供本地 IELTS Writing Task 2 学习闭环：对照自己的原文、保留原意的精修版和独立范文，再把错误与表达转化为可复习的学习卡片。

## 主要功能

- 三栏联动高亮：原句、修改、中文解释和同类练习。
- TR、CC、LR、GRA 四项 AI 练习估分、文本证据和三个提分重点。
- 错误卡片、1/3/7/14/30 天复习、浏览器本地历史和 Markdown 学习笔记导出。
- 明确选择 Ollama 本地模型、OpenAI 兼容接口或可选 Codex CLI。
- 更清晰的配置错误、独立的模型设置、手机布局和键盘操作支持。

## 下载和运行

Windows 10/11 64 位用户：[下载免安装包](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.0/ielts-writing-studio-v0.1.0-windows-x64.zip)，完整解压后双击 `Start Portable.cmd`。包内带有官方 Node.js 运行环境，无需单独安装 Node，也不需要管理员权限。请勿在压缩包内直接启动。

便携包包含 v0.1.0 标签对应的程序、独立启动包装脚本和 Node 运行环境；未附带 AI 模型或任何账号凭据。只查看示例不需要模型，批改真实作文需配置下方任一 AI 服务。

macOS、Linux 或已有 Node 的用户：下载本 Release 的 **Source code (zip)**，解压后安装 Node.js 24 LTS（最低 22.9），在目录中运行：

```powershell
npm start
```

源码包的 Windows 用户也可以双击 `Start Writing Studio.cmd`，然后打开 <http://127.0.0.1:4318>。项目使用 Node 内置模块，不需要 `npm install`。内置示例无需模型即可查看。

如需本地免费推理，安装 Ollama 后运行 `ollama pull qwen2.5:7b`，再在页面右上角选择「Ollama 本地」。也可以复制 `.env.example` 为 `.env`，配置自己的兼容 API；密钥只放服务端。

## 验证和边界

Windows 免安装包已从中文和空格路径解压实测，在系统 PATH 没有 Node 的情况下启动成功，并使用随包 Node 跑完 56 项测试。下载包约 40.6 MB（38.75 MiB），附带 SHA-256 校验文件及组件来源清单。详情见[便携包验证](https://github.com/wang-qingfeng-dev/ielts-writing-studio/blob/main/docs/portable-verification-v0.1.0.md)。

本版本本地 56 项自动测试全部通过，GitHub Actions 的 Node 22/24 测试均通过；一次真实 Codex 检查耗时 438 秒，识别 9 个问题、7 个表达并生成 309 词范文。详细范围见[首发验证记录](https://github.com/wang-qingfeng-dev/ielts-writing-studio/blob/v0.1.0/docs/release-verification-v0.1.0.md)。本机尚未验证真实 Ollama 模型的批改质量。

AI 分数是学习参考，不是雅思官方成绩。v0.1.0 只支持 Task 2 和单用户本地运行，不提供在线免费推理服务；Ollama 的速度和质量取决于本机硬件和模型，外部服务有各自的费用和额度。本项目与 IELTS 官方无关联。
