<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="Ghostty Studio 图标" />
  <h1>Ghostty Studio</h1>
  <p><strong>直接编辑正在使用的 Ghostty 配置，不把它重新生成一遍。</strong></p>
  <p>
    <a href="https://steinshead.github.io/ghostty-studio/">官网</a>
    · <a href="https://github.com/SteinsHead/ghostty-studio/releases/latest">下载 Apple Silicon 版本</a>
    · <a href="docs/media/ghostty-studio-demo.mp4">观看 23 秒演示</a>
    · <a href="README.md">English</a>
  </p>

  [![CI](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml)
  [![Release](https://img.shields.io/github/v/release/SteinsHead/ghostty-studio?include_prereleases&color=a8ff60)](https://github.com/SteinsHead/ghostty-studio/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-a8ff60.svg)](LICENSE)
</div>

<div align="center">
  <a href="docs/media/ghostty-studio-demo.mp4">
    <img src="docs/media/ghostty-studio-demo.gif" width="720" alt="Ghostty Studio 导入本地背景，实时预览，查看实际差异，交给 Ghostty 验证并保存" />
  </a>
</div>

多数配置器会生成一份整洁的新文件。Ghostty Studio 打开你一直在维护的那一份，只修改
你确认过的内容。

- **保留原文档。** 注释、顺序、include、未知设置、换行风格和空行仍在原来的位置。
- **每次写入都看得见。** 内容落盘前先看效果，再查看实际 Diff。
- **由 Ghostty 验证，也留好退路。** 保存前验证候选配置，并创建本地恢复点。
- **内容留在 Mac 上。** 无账号、无云服务、无遥测，也不会加载远程图片。

## 当前支持

| | 预览版支持范围 |
|---|---|
| Mac | Apple Silicon，macOS 11 或更高版本 |
| Ghostty | 可写契约基于 Ghostty 1.3.1 完成审查 |
| 语言 | 简体中文与英文 |
| 分发 | ad-hoc 签名，尚未经过 Apple 公证 |

准确的版本与配置边界请查看[兼容性说明](docs/COMPATIBILITY.md)。

## 使用旅程

1. **打开真实来源。** Studio 发现标准 macOS 与 XDG 根目录，跟随受支持的 include，并在
   其他来源最终生效时给出解释。
2. **在上下文中调整。** 搜索已审查设置；也可以在背景工作台中导入本地 PNG、JPEG，调整
   适配、位置、平铺、可见度和图片切换。
3. **确认写入内容。** 一切先留在草稿中，直到你看完摘要与实际 Diff。
4. **验证并保存。** Studio 检查外部修改，让本机 Ghostty 验证，再原子写入并保留私有
   恢复点。

尚未确认类型、范围、来源行为或版本契约的设置仍可搜索，但会保持只读。Studio 不猜测
写入语义。

## 下载

[下载最新预览版](https://github.com/SteinsHead/ghostty-studio/releases/latest)，适用于 macOS 11
或更高版本的 Apple Silicon Mac。Release 页面附有 SHA-256 校验值。

预览版尚未公证，macOS 首次打开时可能要求确认。请使用系统正常的安全审查流程，不要
关闭 Gatekeeper。你也可以从源码构建。

## 从源码运行

需要 Ghostty、Xcode Command Line Tools、Node 22.22.2、pnpm 10 和仓库固定的 Rust 工具链。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

运行前端、官网与 Rust 的完整检查：

```bash
pnpm check
```

`pnpm dev` 会打开只使用示例数据的只读浏览器演示。`pnpm package:macos-local` 用于生成
开发用途的本地 ad-hoc 安装包，不能证明发布者身份。

## 文档与帮助

- [文档索引](docs/README.md)
- [兼容性](docs/COMPATIBILITY.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [架构](docs/ARCHITECTURE.md)
- [威胁模型](docs/THREAT_MODEL.md)
- [路线图](docs/ROADMAP.md)
- [安全策略](SECURITY.md)

欢迎提交 bug、聚焦的小型 PR，以及真实 Ghostty 场景反馈。请先查看[支持说明](SUPPORT.md)
或[参与贡献](CONTRIBUTING.md)，并且只使用合成或完整脱敏的配置、路径、日志和媒体。

Ghostty Studio 以 [MIT 许可](LICENSE)开放源代码。它是独立社区项目，与 Ghostty 官方没有
隶属或背书关系。
