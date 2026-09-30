# v0.2.0 验证记录

日期：2026-09-30。Windows 本机 Node.js v24.19.0；macOS / Linux 通过 GitHub Actions 验证。

## 自动测试与界面

- 152 项自动测试通过。新增版本比较、固定仓库地址、大小与 SHA256 校验、损坏下载清理重试、重复安装拦截、源码/便携/Mac 安装保护、跨站请求及分析期间更新互斥。
- Windows / Ubuntu / macOS，Node 22 / 24，共六组 CI 通过。最终源代码对应运行见 [测试工作流](https://github.com/wang-qingfeng-dev/ielts-writing-studio/actions/workflows/ci.yml)。
- 浏览器验证页面加载、检查更新、无新版时隐藏安装按钮、关闭更新弹窗；更新页面代码后 Task 1 草稿、已完成结果与历史仍可恢复。
- Task 1 学术类与培训类通过 DeepSeek 和 Qwen3.5:4b 真实分析。材料、耗时、输出边界见 [预览阶段实测记录](task1-preview-verification.md)。

## Windows 包与升级

- 安装器在隔离的中文/空格目录安装，内置 Node 启动与 HTTP 返回通过；没有修改正式安装或真实云端配置。
- 使用实际 v0.1.2 安装器建立隔离旧版，再由 `install-update.ps1` 完成 SHA256 验证、原目录覆盖安装与原端口重启至 v0.2.0。
- 合成在线设置与 `.env` 文件逐字节校验保留，新版恢复设置，Task 1 和更新入口可见。
- 在线下载/校验/并发由模拟 HTTP 测试覆盖，安装重启由真实安装器覆盖。尚不存在比 v0.2.0 更新的公开发行，因此不把此分层测试描述为“已从公开服务器升级至未来版本”。
- 浏览器记录的保留条件是同一浏览器、地址和端口；清理浏览器数据或换浏览器不会自动迁移记录。

## Mac 包

- macOS arm64 与 Intel x64 分别构建；官方 Node SHA256 校验通过，完整许可证保留。
- 解压到含空格及中文的路径，验证 `.command` 执行权限、Node 架构、启动、版本、Task 1 页面、在线 AI 设置与退出后端口释放。
- 过程见 [Mac 打包工作流](https://github.com/wang-qingfeng-dev/ielts-writing-studio/actions/workflows/macos-package.yml)。包内 manifest 记录准确源码提交与运行时哈希。
- 未进行 Apple Developer ID 签名或公证；未验证用户真机 Gatekeeper 操作、Safari、Mac 真实 AI 推理或所有 macOS 版本。

## 边界与发布检查

AI 估分准确率没有通过真人考官标注数据集评估，不能承诺提分。Task 1 暂不直接识图。豆包与腾讯混元预设经过配置/模拟接口测试，不能据此称所有服务商均已真实调用。

发布脚本在公开前核对所有下载文件的 SHA256、大小和来源提交，公开后重新下载 Windows / Mac 二进制核对一致性。包内不含作者密钥、私人作文、模型或免费账户额度。
