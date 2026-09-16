# 句进 · 雅思写作工作台

一个可自托管的 IELTS Writing Task 2 学习工作台：原文诊断、保留原意的精修、独立范文、四项标准估分和可自测复习库。

## 关于“免费 AI”

GitHub 只能保存和分发代码，不能为每个访问者免费提供无限模型推理。公开网页不能放入作者的 API key，否则任何人都可以消耗作者额度。这个项目因此支持三种提供商：

1. **Ollama（推荐，免费本地推理）**：每位使用者在自己的电脑安装 [Ollama](https://ollama.com/)，运行 `ollama pull qwen2.5:7b`。题目和作文留在本机，不需要 API key。
2. **OpenAI 兼容接口**：可以接 Groq、OpenRouter、LM Studio、vLLM 或其他兼容 `/chat/completions` 的服务。免费额度取决于服务商；key 只放在服务端环境变量中。
3. **Codex CLI（兼容旧环境）**：本项目仍支持当前本机开发配置，但公开仓库不依赖它。

GitHub Pages 只能展示预设示例，因为它不能运行 `server.mjs`，也不能安全保存 API key。要让访客真正提交作文，需要每位访客自托管 Node + Ollama，或者部署自己的后端并配置自己的兼容接口。项目不承诺无限免费公共 AI。

## 本机运行

安装 Node.js 20+ 和 Ollama 后：

```powershell
ollama pull qwen2.5:7b
Copy-Item .env.example .env
node server.mjs
```

然后打开 http://127.0.0.1:4318。Windows 用户也可以双击 **Start Writing Studio.cmd**；启动器会在后台启动服务并打开浏览器。服务只监听本机地址。

如果 Ollama 使用其他模型：

```powershell
$env:AI_MODEL = 'qwen2.5:3b'
node server.mjs
```

如果使用 OpenAI 兼容接口：

```powershell
$env:AI_PROVIDER = 'openai-compatible'
$env:AI_BASE_URL = 'https://api.groq.com/openai/v1'
$env:AI_API_KEY = '只在服务端设置，不要放进 public/ 文件'
$env:AI_MODEL = '你的模型名'
node server.mjs
```

也可以把这些变量写进 `.env`；项目不会自动读取 `.env`，请在启动脚本、PowerShell 或部署平台的环境变量设置中加载它们。这样可以避免无依赖 dotenv 带来的隐式密钥读取。

## 使用方法

1. 首次打开显示带明确标记的预设学习示例。点击 **新练习**，粘贴完整题目和英文作文，选择目标分数。
2. 点击 **开始分析**。真实批改通常需要数分钟；可以随时停止，题目和原文不会丢失。顶部状态会显示当前 provider。
3. 页面右上角的 **切到本地 AI / 切到 Codex** 按钮可以随时切换模式；切换只影响当前本机服务，不会改动作文记录。Ollama 未安装或没有模型时，状态会明确提示安装命令。
4. 先看三个提分重点。点击原文或精修版本的彩色标注，联动查看原句、修改、中文原因和同类练习。
5. 右栏范文只接收题目与目标分，不接收学生原文。真实练习中默认折叠，可随时展开。
6. 三栏各有 TR、CC、LR、GRA 四项估分与具体证据。它们是 AI 练习估分，非官方成绩；语法改正不保证总分提升。
7. 收藏底部的错误、搭配与论证卡片。在 **我的复习库** 遮住答案自测，按 1、3、7、14、30 天复习；不熟悉的卡片 10 分钟后重练。
8. **练习记录** 保存最近 30 篇真实练习及草稿。**导出学习笔记** 下载完整 Markdown 文件，包含三篇作文、评分、修改和学习卡片。

草稿、练习记录和收藏保存在当前浏览器本机存储中。换浏览器或清除浏览器数据不会同步这些内容。重要练习请导出备份。小练习采用本地参考答案对照；搭配检测只检查使用情况，不提供整句 AI 语法审核。

## 项目文件

- `public/index.html`：页面结构。
- `public/app.js`：交互、自动保存、历史记录与间隔复习。
- `public/styles.css`：桌面三栏、手机标签切换和无障碍样式。
- `public/demo.js`：明确标记的预设示例。
- `server.mjs`：本机 HTTP 服务，调用选定 provider 进行真实分析。
- `provider.mjs`：Ollama、OpenAI 兼容接口和 Codex 的 provider 选择与 JSON 调用。
- `analysis-schema.mjs`：评分、引用和数据完整性校验。
- `tests/`：自动测试与真实调用检查。

后端将作文视为待分析内容。两个独立请求分别完成批改和范文；返回内容必须通过结构、分数、来源引用和唯一位置校验。服务故障不会用示例结果代替真实批改。Codex 分支使用无交互、只读调用；HTTP provider 只发送必要的题目、作文和提示。

## 验证

在项目目录运行：

```powershell
node --test tests/backend.test.mjs tests/frontend.test.mjs tests/state.test.mjs
```

真实 API 检查（会使用当前 provider 的本地模型或账户额度）：

```powershell
node tests/live-check.mjs
```

网页真实分析需要 Ollama 本地模型或有效的兼容接口配置。若显示连接不可用，检查顶部提示并刷新；后台错误记录在 `server-error.log`。此版本不包含 Task 1、云同步或多人账号。

参考：[IELTS 官方评分说明](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail) · [Codex 非交互模式](https://developers.openai.com/codex/noninteractive)
