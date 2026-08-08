<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="Ghostty Studio 图标" />
  <h1>Ghostty Studio</h1>
  <p><strong>直接可视化编辑正在使用的 Ghostty 配置，保留它原本的样子。</strong></p>
  <p>
    <a href="https://github.com/SteinsHead/ghostty-studio/releases/tag/v0.4.0">下载 Apple Silicon 版本</a>
    · <a href="docs/media/ghostty-studio-demo.mp4">观看演示</a>
    · <a href="README.md">English</a>
  </p>

  [![CI](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-a8ff60.svg)](LICENSE)
</div>

<div align="center">
  <a href="docs/media/ghostty-studio-demo.mp4">
    <img src="docs/media/ghostty-studio-demo.gif" width="720" alt="Ghostty Studio：实时预览背景修改，检查准确差异，验证并保存" />
  </a>
</div>

多数配置器会生成一份新文件。Ghostty Studio 打开你正在使用的那一份，只写入你确认过
的改动。

- **原配置保持原样。** 注释、顺序、未知设置、空行、BOM、CRLF 和末尾换行风格都会保留。
- **写入前一目了然。** 先看预览和准确 Diff，再由 Ghostty 验证；需要时还可以从本地快照恢复。
- **所有内容留在本机。** 不需要账号，没有云服务和遥测，界面也没有通用的文件、网络或
  shell 访问能力。

## 能做什么

- 没有需要选择的事项时，直接打开上次使用的配置进入编辑。
- 从本机安装的 Ghostty 读取设置目录，不用维护一份容易过期的静态表格。
- 发现 macOS 与 XDG 配置候选；只有多个来源都可用时才请你选择。
- 尚无默认配置时，经确认安全创建新配置，绝不覆盖已有文件。
- 搜索并编辑已支持的设置；视觉选项会在相关页面提供上下文预览。
- 将本地 PNG、JPEG 导入私有图片库，支持多选、手动或随机切换，以及适配、位置、平铺、
  可见度和实时预览。
- 区分“正在编辑的文件”和 Ghostty 的最终来源；若草稿会被后续 include 覆盖，可直接改到
  真正生效的文件，保存后再由 Ghostty 核对最终标量值。
- 默认跟随系统语言，也可随时在简体中文与英文之间切换。
- 主流程只呈现真正能调整的设置；完整 Ghostty 目录仍可随时搜索和查阅。
- 所有调整先留在草稿中，确认准确 diff 后才写入文件。
- 保留注释、顺序、未知设置、空行、BOM、CRLF 和末尾换行风格。
- 每次保存前都交给 Ghostty 验证，并自动创建本地快照。

所有内容都留在本机。应用不需要账号，没有云服务和遥测，也不会给界面通用的 shell
或文件访问能力。

## 下载

[下载 Ghostty Studio v0.4.0](https://github.com/SteinsHead/ghostty-studio/releases/tag/v0.4.0)，
适用于 macOS 11 或更高版本的 Apple Silicon Mac。

这是一个早期预览版。应用已做 ad-hoc 签名，但尚未经过 Apple 公证，所以 macOS 首次
打开时可能要求你确认。Release 页面附有 SHA-256 校验值；如果你更在意构建过程，也可以
直接从源码运行。

## 目前的状态

Ghostty Studio 仍是早期预览版，当前边界很明确：

- 桌面端目前以 macOS 为主，可写设置契约基于 Ghostty 1.3.1 测试。
- Ghostty 1.3.1 在 macOS 上已有 31 项经过验证的设置可以调整；其余设置仍可搜索，并会说明为什么需要不同的编辑方式。
- 终端画面是安全的 DOM 模拟器。Studio 会按 Ghostty 1.3.1 的默认根文件及可变全局
  include/reset 队列判断经过审核的标量写入；尚未通过同等兼容性审计的 Ghostty 版本会
  停用依赖来源顺序的写入，重复设置和未审核语义仍保持只读。
- 扩展 manifest 格式和校验器目前只面向开发者；应用内没有扩展浏览、安装或执行界面。
- 预览安装包采用 ad-hoc 签名，尚未经过 Developer ID 签名和 Apple 公证。
- 界面支持简体中文与英文。

## 本地运行

需要 macOS 11 或更高版本、Ghostty、Xcode Command Line Tools、Node 22.11、pnpm 10
和 Rust。仓库已经固定所需的 Node 与 Rust 版本。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

只体验不会访问本机配置的只读浏览器预览：

```bash
pnpm dev
```

运行全部前端与 Rust 检查：

```bash
pnpm check
```

构建适合本机安装的 ad-hoc `.app` 与 DMG：

```bash
pnpm package:macos-local
```

这个本地包用于开发和个人安装，尚未公证，也不能证明发布者身份。

## 保存时发生什么

Ghostty Studio 不会重新生成整份配置，而是在原文档上只修改你确认过的设置。替换文件
前，应用会检查是否有其他程序动过配置，让 Ghostty 验证候选内容，并保存一个可以恢复
的快照。

如果尚无任何默认配置，应用也可以创建一个固定的空文件：目标只能来自后端发现结果，
确认前后都会重新探测，Unix 上逐级使用 no-follow 目录描述符并以 `0600` 独占创建。创建后
若完整验证无法确认，应用会保留文件并重新读取真实状态，不会用有竞争窗口的自动删除去
冒险碰用户文件。

更完整的设计与安全细节放在文档中：

- [架构](docs/ARCHITECTURE.md)
- [产品体验与平台边界](docs/PRODUCT_EXPERIENCE.md)
- [产品设计准则](docs/product-design.md)
- [威胁模型](docs/THREAT_MODEL.md)
- [扩展设计](docs/EXTENSIONS.md)
- [路线图](docs/ROADMAP.md)
- [更新日志](CHANGELOG.md)
- [第三方软件声明](THIRD_PARTY_NOTICES.md)
- [安全策略](SECURITY.md)

## 参与项目

欢迎提交 bug、聚焦的小型 PR，以及来自真实 Ghostty 使用场景的建议。示例配置请务必
脱敏，不要附带令牌、私人路径、命令或环境变量值。

## 许可证

[MIT](LICENSE)

Ghostty Studio 是独立的社区项目，与 Ghostty 官方没有隶属或背书关系。
