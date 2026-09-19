# Windows 一键安装器

`build-windows-installer.ps1` 会先从指定的 Git 提交构建完整免安装运行包，再用 Inno Setup 生成一个无需管理员权限的 `setup.exe`。默认安装到：

`%LOCALAPPDATA%\Programs\JujinWritingStudio`

安装包内含官方 Node.js 24 运行时，用户不需要安装 Node、npm 或执行命令。安装完成后会自动打开首次设置页：

`http://127.0.0.1:4318/?setup=1`

首次设置页提供两种方式，安装包不包含模型、API 密钥或账号额度：

- 本地 AI：点击「一键准备本地 AI」，程序自动下载并校验独立的 Ollama 引擎、准备模型。无需先安装系统 Ollama 或执行命令。首次需联网，下载大小与磁盘要求以页面显示为准；准备完成后可离线使用，速度和效果取决于电脑与模型。
- 在线 AI：点击「设置在线 AI」，选择服务商，按页面链接获取自己的 API 密钥，粘贴后点击「连接并使用」。部分服务提供有限免费额度，具体规则以服务商为准；软件不提供共享密钥或无限免费服务。无需下载模型或编辑 `.env`。

以后双击 `Setup AI.cmd` 可再次打开同一设置页。这个入口本身不下载模型，也不要求用户另行安装 Ollama。

## 构建

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/installer/build-windows-installer.ps1 `
  -SourceRef main -ReleaseVersion v0.1.2
```

`-SourceRef` 可以是分支、标签或完整提交；正式发行包应与同名 Git 标签一致。实际源码以发行清单中的 `SourceCommit` 为准，构建本身不会上传或发布。脚本会核对便携包来源；如果系统没有 `ISCC.exe`，会把官方 Inno Setup 编译器准备在仓库内被 Git 忽略的 `.tools\inno` 工具目录。

## 隔离测试

```powershell
powershell -ExecutionPolicy Bypass -File scripts/installer/test-windows-installer.ps1 `
  -InstallerPath release-artifacts\installer-output\ielts-writing-studio-v0.1.2-windows-x64-setup.exe
```

测试使用 `/TESTINSTALL=1`，只在临时目录解包，不注册卸载项、不创建快捷方式、不自动打开浏览器，也不关闭其他应用。测试服务使用独立的本地 AI 和云配置目录，检查内置 Node、应用版本、设置模块及页面，然后关闭本次测试进程并清理目录。此模式须搭配新版安装器，旧安装器不支持该隔离参数。

正式卸载只移除应用安装目录。本地 AI 保存在 `%LOCALAPPDATA%\JujinWritingStudio\local-ai`，在线设置保存在 `%LOCALAPPDATA%\JujinWritingStudio\settings`，练习记录保存在当前浏览器中。卸载会保留这些数据；不想保留在线密钥时，可先在「管理在线 AI」中删除已保存的连接。
