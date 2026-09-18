# v0.1.1 发布验证

本文件记录 `v0.1.1` Windows 发布包的来源、测试和校验值。发布包来自提交 `fdd3573fc9e88d00fd4226dc13f1ad5e068a0e4a`。

## 自动化验证

- Node.js 测试：63 项通过，0 项失败。
- Windows x64 便携包：在中文和带空格的目录中启动成功；使用随包 Node.js 运行；HTTP 页面返回 200。
- Windows x64 安装器：临时目录安装、启动、首次设置页、内置 Node.js 和卸载清理均通过；无需管理员权限。
- 安装器首次启动会打开 `/?setup=1`。模型不会打包进安装器，首次准备本地 AI 时需要联网下载 Ollama 和 Qwen2.5 模型。

## 发布文件

| 文件 | 校验方式 | 说明 |
| --- | --- | --- |
| `ielts-writing-studio-v0.1.1-windows-x64-setup.exe` | 同名 `.sha256` 和安装器 manifest | Windows x64 一键安装程序 |
| `ielts-writing-studio-v0.1.1-windows-x64.zip` | 同名 `.sha256` 和便携包 manifest | Windows x64 免安装便携包 |

两个包都不包含 AI 模型、API key 或个人作文数据。下载后请使用同名 `.sha256` 文件核对 SHA-256；安装器 manifest 还记录了来源提交和文件大小。安装器默认安装到当前用户的 `%LOCALAPPDATA%\\Programs\\JujinWritingStudio`，不需要管理员权限。

## 限制

AI 评分是学习参考，不是雅思官方成绩。模型下载速度、内存占用和批改质量取决于用户的电脑与所选模型；项目没有承诺免费在线推理或无限额度。
