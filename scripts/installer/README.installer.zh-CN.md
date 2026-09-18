# Windows 一键安装器

`build-windows-installer.ps1` 会先从指定的 Git 提交构建完整免安装运行包，再用 Inno Setup 生成一个无需管理员权限的 `setup.exe`。默认安装到：

`%LOCALAPPDATA%\Programs\JujinWritingStudio`

安装包内含官方 Node.js 24 运行时，用户不需要安装 Node、npm 或执行命令。安装完成后会自动打开首次设置页：

`http://127.0.0.1:4318/?setup=1`

本地 AI 模型不随安装器捆绑。这样下载包保持可控，安装器也不会偷偷消耗用户流量。安装器提供 `Setup AI.cmd`，在已安装 Ollama 后可一键下载默认的 `qwen2.5:7b` 模型；首次下载大约需要 3.5–6.5 GB，建议预留至少 12 GB 磁盘空间。也可以直接在首次设置页选择兼容的在线 API，但项目不会承诺第三方服务永久免费或可用。

## 构建

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/installer/build-windows-installer.ps1 `
  -SourceRef main -ReleaseVersion v0.1.1
```

`-SourceRef` 可以是分支、标签或完整提交。脚本会固定源码提交并核对便携包清单；如果系统没有 `ISCC.exe`，会把官方 Inno Setup 编译器下载到仓库外的 `.tools\inno`，不会修改系统安装。

## 隔离测试

```powershell
powershell -ExecutionPolicy Bypass -File scripts/installer/test-windows-installer.ps1 `
  -InstallerPath release-artifacts\installer-output\ielts-writing-studio-v0.1.1-windows-x64-setup.exe
```

测试会在临时目录安装、启动本地服务、检查内置 Node 和页面，然后关闭测试进程并删除临时目录，不会结束其他 Node 进程。

卸载只移除应用安装目录。Ollama 模型保存在用户目录，浏览器记录保存在浏览器中，二者都会保留。
