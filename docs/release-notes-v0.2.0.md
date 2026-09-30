# v0.2.0 · 小作文、Mac 与 Windows 在线更新

新增 Task 1 学术类图表/流程/地图和培训类书信，继续支持 Task 2。三栏对照、TA/TR 四项练习估分、中文反馈、历史和笔记导出统一使用。

## 下载哪个包

- Windows 普通用户：`ielts-writing-studio-v0.2.0-windows-x64-setup.exe`，双击安装。
- Windows 免安装：`ielts-writing-studio-v0.2.0-windows-x64.zip`，完整解压，双击 `Start Portable.cmd`。
- Mac M 系列芯片：`ielts-writing-studio-v0.2.0-macos-arm64.zip`。
- Intel Mac：`ielts-writing-studio-v0.2.0-macos-x64.zip`。

Mac 完整解压后双击 `Start Writing Studio.command`，保留终端窗口。所有包自带 Node.js，不含模型或 API 密钥。Mac 包未签名/公证，系统可能要求确认打开；macOS 验证范围为自动测试与启动/HTTP，不代表用户真机或 Gatekeeper 全覆盖。Mac 推荐在线 AI，目前不提供自动下载本地模型功能。

## Windows 在线更新

v0.1.2 及以前没有更新入口，**需要先手动安装这次新版**。关闭旧版后运行安装程序，选择原安装目录。从 v0.2.0 开始，Windows x64 安装版在页面底部点击“检查更新”，发现新版后点“下载、安装并重启”。下载自本仓库，大小与 SHA-256 校验通过后才安装。

不自动后台下载，不在批改时安装。保留外部 AI 设置和模型；使用原浏览器、原地址和端口时，学习记录仍在。重要笔记建议先导出。便携版、源码和 Mac 使用发行页下载更新。

## 在线 AI 与使用范围

设置里可一键打开 DeepSeek、豆包（火山方舟）、腾讯混元等官方平台。首次创建并粘贴自己的 API 密钥，随后直接在本页批改，不必来回复制作文。**网页登录聊天账户或开通会员不等于 API 授权**；腾讯混元接口也不是元宝聊天账号接入。服务费用与额度以平台为准，无共享密钥或无限免费承诺。

Task 1 学术类目前需要填写原图文字信息，不支持直接识图。AI 估分不是官方成绩。小型本地模型的速度和反馈质量取决于设备与题目，无法核实的附加标注会省略并提示。

预发布阶段已完成 Task 1 两类的 DeepSeek / Qwen3.5:4b 真实请求验证；自动测试也覆盖更新校验、错误恢复及并发保护。完整证据见仓库验证记录与本次 GitHub Actions。
