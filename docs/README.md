# Documentation · 文档

Ghostty Studio is a local visual editor for the Ghostty configuration you already use. Start with
the path that matches what you need.

Ghostty Studio 是本地 Ghostty 配置编辑器。按当前问题选择入口，不需要从头阅读全部文档。

## Use the app · 使用应用

| Need | 中文 | Guide |
|---|---|---|
| Check whether a system or Ghostty version is supported | 查看系统、Ghostty 版本和功能边界 | [Compatibility](COMPATIBILITY.md) |
| Fix a save, preview, image, conflict, or launch problem | 排查保存、预览、图片、冲突或启动问题 | [Troubleshooting](TROUBLESHOOTING.md) |
| Understand what comes next | 查看正在改进和暂不承诺的能力 | [Roadmap](ROADMAP.md) |

## Understand the product · 了解产品

- [Product experience](PRODUCT_EXPERIENCE.md): the intended journey and platform behavior.
- [Architecture](ARCHITECTURE.md): UI, Rust boundary, config graph, and safe writer.
- [Threat model](THREAT_MODEL.md): protected data, trust boundaries, and known residual risks.
- [Product design principles](product-design.md): interaction and visual standards.

## Build and extend · 开发与扩展

- [Implementation plan](PLAN.md): technical choices and delivery phases.
- [Release candidates](RELEASING.md): build evidence, review steps, and signing boundaries.
- [Extension contract](EXTENSIONS.md): the current data-only extension boundary.
- [Architecture decisions](adr/): decisions that should not be changed accidentally.
- [Open-source playbook](OPEN_SOURCE_PLAYBOOK.md): product, community, and growth decisions.
- [Launch kit](LAUNCH_KIT.md): reusable, honest copy and a privacy-safe release checklist.

For a security concern, follow the private reporting path in [SECURITY.md](../SECURITY.md). Do not
attach a real configuration, home-directory path, token, command, or terminal history to a public
issue.
