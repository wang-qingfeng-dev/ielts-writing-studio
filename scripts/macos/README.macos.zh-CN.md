# 句进 · Mac 便携版

支持 macOS 13.5 或更新版本。Apple Silicon（M1/M2/M3/M4 等）选择 arm64 包，Intel Mac 选择 x64 包。在苹果菜单“关于本机”查看芯片类型。

1. 完整解压 ZIP，将文件夹放在“应用程序”或个人文稿目录，保留 runtime 和 public 等子目录。
2. 双击 `Start Writing Studio.command`。它会打开终端并启动本机网页，已经包含 Node.js，无需安装 npm 或编程环境。
3. 保留终端窗口。点击网页的“设置在线 AI”，按按钮打开官方账号/密钥页面，首次连接一次，以后在本页直接批改。
4. 结束使用时在终端按 Control+C，再关闭窗口。重复打开会复用已运行的同版本服务。

此包未经过 Apple Developer ID 签名或公证，macOS 下载安全提示可能拦截启动。只从本项目 GitHub Release 下载；如系统提示无法验证开发者，请先核对来源和 SHA256，再按 macOS 官方允许打开该文件的步骤操作。软件不会自动关闭或绕过系统安全保护。

## AI、费用与数据

Mac 版推荐使用在线 AI。不捆绑 API 密钥、账号额度或模型，也没有“网页登录聊天会员就自动调用”的授权功能。配置成功后，题目、原图文字材料和作文发送给所选服务商，结果显示在本应用；费用或免费额度由服务商决定。

Windows 的“一键准备本地 AI”不适用于 Mac。本包不会在 Mac 自动下载安装 Ollama。已有 Ollama 的用户可以自行配置模型后选择本地模式，但 Apple Silicon / Intel 实际推理速度与质量未在用户真机上验证。

Task 1 学术类需填写图表数据/流程/地图的文字材料，暂不直接识图；培训类书信和 Task 2 可直接粘贴题目与作文。AI 估分不是官方成绩。

在线配置保存在 `~/Library/Application Support/JujinWritingStudio/settings`；练习保存在当前浏览器。删除应用文件夹不会删除这些记录，删除密钥请用页面内的“删除已保存的连接”。服务只监听本机 `127.0.0.1`，请勿用于公网多人服务。

包内 `MAC-MANIFEST.json` 记录源码提交、架构、Node 版本和官方 SHA256。runtime 保留 Node 官方许可证。macOS CI 验证包括测试套件、真实架构运行时和启动/HTTP 冒烟；不等于 Safari、Gatekeeper、用户真机或真实 AI 推理全覆盖测试。
