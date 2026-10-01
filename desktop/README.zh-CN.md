# 桌面版

桌面版使用 Electron 创建独立应用窗口，窗口内部加载本机服务，不依赖用户打开 Chrome/Edge，也不把服务暴露到局域网。在线 AI 密钥继续由本机服务端保存；网页端与桌面端共用同一套分析、历史和更新逻辑。

开发运行：

```powershell
npm install
npm run desktop
```

首次运行需要下载 Electron 开发依赖。正式 Windows / macOS 包会在后续用户测试通过后制作；本阶段只提交可运行的桌面测试版本。
