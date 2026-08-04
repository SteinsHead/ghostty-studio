# 扩展 manifest 契约

> 当前状态：**开发者契约**。仓库包含 manifest 格式与后端静态校验器，但 Ghostty Studio
> 没有面向普通用户的扩展浏览、安装、管理或执行界面。

Ghostty Studio 把扩展设计成严格的数据包，而不是能在应用内运行代码的传统插件。
WebView 不导入第三方 JavaScript 或 HTML，扩展也不能读取文件、联网、启动进程或调用
Tauri IPC。

这样做的原因很直接：终端配置可能包含命令、环境变量和私人路径。为了给设置增加说明或
预设而引入任意代码执行，风险与收益并不相称。

## Manifest v1

每个扩展声明：

- `manifestVersion`：格式版本，当前只接受 `1`；
- `id`、`name`、`version`：稳定标识、名称和语义化版本；
- `hostApi`：兼容的 Ghostty Studio 扩展 API 版本范围；
- `ghostty`：可选的 Ghostty 语义化版本范围；
- `capabilities`：明确请求的能力；
- `contributes`：与所请求能力对应的声明式内容。

当前允许的能力为：

| 能力 | 允许声明的内容 | 当前是否应用到产品 |
|---|---|---|
| `schema.metadata` | 设置标签、分类、说明、别名；非核心键可声明控件提示 | 只检查，不合并 |
| `presets` | 有名称的设置值集合 | 只检查，不执行 |
| `migrations.declarative` | 键重命名与有限值映射 | 只检查，不执行 |
| `preview.declarative` | 安全预览 metadata | 预留，尚无贡献结构 |
| `core.override` | 核心设置的行为 metadata 覆盖 | 仅为未来受信任包预留 |

贡献内容必须请求相应能力。社区 metadata 可以为已有核心键补充标签、说明、别名和分类，
但不能改变控件类型、选项或风险级别。`core.override` 只有在未来的安装流程确认包已被用户
信任且完整性固定时才可能开放；当前检查器始终按不受信任输入处理，因此会拒绝它。

## 检查边界

本机 Tauri 后端会执行以下静态检查：

- manifest 不超过 512 KiB，总贡献不超过 1,000 项；
- JSON 结构严格，未知字段会被拒绝；
- ID、短文本、列表和值大小满足上限；
- 扩展版本、`hostApi` 和 `ghostty` 使用有效的语义化版本要求；
- `hostApi` 匹配当前 host API，`ghostty` 匹配本机实际安装版本；
- 能力在 allowlist 中、没有重复，并与实际贡献对应；
- 设置、预设和迁移标识不重复，控件类型与风险分类在有限枚举内；
- 未受信任输入不能改变核心设置的行为。

校验器通过后端契约和自动测试供开发者使用。它不构成安装流程，校验通过也不代表作者或
来源可信；未来任何扩展工作流都必须以桌面 Rust 后端的结果为准。

检查器不会：

- 下载 manifest 中提到的任何资源；
- 把 JSON 写入配置目录或扩展目录；
- 将贡献合并到设置目录、预览、预设或迁移流程；
- 验证作者身份、签名、发布渠道或恶意意图；
- 推断一个扩展在未来版本中仍然兼容。

## 示例

```json
{
  "manifestVersion": 1,
  "id": "dev.example.workflow",
  "name": "Example workflow metadata",
  "version": "1.2.0",
  "hostApi": "^1.0",
  "ghostty": ">=1.3",
  "capabilities": ["schema.metadata", "presets"],
  "contributes": {
    "settings": [
      {
        "key": "example-mode",
        "category": "Example",
        "label": "Example mode",
        "kind": "select",
        "choices": ["a", "b"],
        "risk": "normal"
      }
    ],
    "presets": [
      {
        "id": "dev.example.fast",
        "name": "Fast",
        "values": { "example-mode": ["a"] }
      }
    ]
  }
}
```

这是格式示例，不是推荐安装来源，也不会在当前版本中改变任何设置。

## 未来安装生命周期

在开放安装前，产品必须同时具备以下能力：

1. 展示来源、发布者信息、内容 SHA-256、请求能力、贡献范围和兼容性结果；
2. 经过用户确认后存入隔离目录，并记录启用状态、固定版本和完整性；
3. 每次应用或 Ghostty 升级后重新检查 manifest 与逐设置行为契约；
4. 支持禁用、卸载、回滚和隔离不兼容版本，且不修改用户原始配置；
5. 预设只生成可审查草稿，迁移展示逐项 diff，不允许绕过 Ghostty 校验与保存事务；
6. 建立命名空间占用、受信任核心包和撤销机制，再考虑公共 registry。

签名可以证明内容来自某个密钥，但不能证明内容安全。即使未来加入签名，能力最小化、
严格解析、大小限制、版本匹配和用户确认仍然不可省略。

## 可执行扩展不是默认升级路径

如果出现声明式数据无法覆盖的真实需求，项目会单独评估受限的独立进程或 WASI host：
默认无网络、无文件访问，限制 CPU、内存、响应大小和执行时间，通过版本化协议通信。
它必须是显式选择的高风险能力，不能让普通 manifest 在升级后自动获得代码执行权限。

平台体验、信任边界和阶段安排见[产品体验与平台边界](PRODUCT_EXPERIENCE.md)与
[路线图](ROADMAP.md)。
