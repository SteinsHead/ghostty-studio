# Ghostty Studio 实施方案

## 一、产品原则

Ghostty Studio 不是“把配置项塞进表单”的生成器，而是本地配置管理器。
它需要同时服务两类用户：希望完全不接触文本配置的新用户，以及已有复杂
配置、注释、include 和 dotfiles 工作流的高级用户。

不可妥协的原则：

- **本地优先：** 不上传配置，不依赖云端，不需要账号。
- **默认只读：** 打开应用只做发现与解析；写入必须经过显式 Apply。
- **无损往返：** 未修改的字节保持不变，未知配置永不丢失。
- **Ghostty 是最终裁判：** 内部校验用于即时反馈，保存前仍调用已安装版本的
  `ghostty +validate-config`。
- **渐进增强：** schema 不认识的新字段完整保留；第一版默认只读，未来只在隔离的 raw
  专家视图中编辑，绝不塞进未经审计的通用控件。
- **可解释（目标态）：** 每个生效值显示来源、默认值和覆盖关系；在 merge/reset 语义
  完整建模前，当前版本只显示脱敏 provenance 观察图，不冒充最终有效配置。
- **最小权限：** WebView 没有通用文件系统或 shell 权限，只能调用窄化的 Rust 命令。

## 二、方案比较与结论

| 方案 | 优点 | 主要问题 | 结论 |
|---|---|---|---|
| SwiftUI | macOS 原生、系统集成最佳 | Linux 无法复用；插件与 UI 演进成本高 | 不作为主架构 |
| Electron | 生态成熟、开发快 | 体积与内存高；安全加固成本高 | 不采用 |
| 本地 Web 服务 | 跨平台、调试简单 | 端口、CSRF、生命周期和文件权限边界复杂 | 不采用 |
| TUI | 轻量、适合键盘 | 预览、发现性与无障碍能力不足 | 可作为未来辅助客户端 |
| **Tauri 2** | 小体积、跨 macOS/Linux、Rust 文件安全、细粒度能力控制 | 工具链更复杂、需维护前后端契约 | **采用** |

前端选择 React + TypeScript。核心领域逻辑不依赖 React，未来可以替换 UI。
后端使用 Rust，负责路径、进程、解析、校验、锁、备份和原子写入。

## 三、写入模式

产品规划提供三种模式，并明确显示风险；当前纵向切片已实现只读探索和受审计标量的
原地精确编辑，托管覆盖层仍在后续阶段：

1. **只读探索：** 默认模式，可查看有效配置、来源和预览。
2. **托管覆盖层（推荐，但必须先计算加载图）：** 在最终安全加载叶节点中一次性加入
   可选 include，之后只管理独立的 `ghostty-studio.conf`。这最适合长期使用和 Git
   管理；不能仅凭“写在根文件末尾”假定它拥有最高优先级。
3. **原地精确编辑：** 修改现有文件中目标键的最后有效定义；保留其他字节。

任何模式都必须先检查外部改动 revision，生成候选内容，执行内部校验和 Ghostty
校验，创建快照，再原子替换。提交前失败时原文件不变；提交后无法确认或最终校验失败
时必须显式报错、刷新/废弃会话并做 revision-aware 恢复，绝不覆盖更新的外部编辑。

## 四、配置与版本适配

运行时适配按以下优先级构建：

1. 探测 Ghostty 可执行文件和版本。
2. 调用 `+show-config --default --docs` 获取当前安装版本的键、默认值与文档。
3. 使用内置、版本化 metadata overlay 补充类别、控件类型、枚举和安全提示。
4. 使用 `+list-themes --plain`、`+list-fonts`、`+list-actions` 和
   `+list-keybinds` 填充动态选择器。
5. 对无法识别的字段完整保留并默认只读；后续由隔离的 raw fallback 承接。

schema 以 Ghostty 版本和输出 hash 为缓存键。stderr 与 exit code 分开处理；已知的
非致命诊断不会误判为命令失败。

## 五、配置图与来源

解析器保留空行、注释、换行符、原始赋值文本和未知行。配置解析不尝试“美化”。
`config-file` 构成有向图：

- 相对路径相对于声明文件解析。
- `?` 表示可选文件。
- include 在声明文件全部读取后按 Ghostty 当前版本的队列顺序生效；1.3.x 的嵌套
  include 呈广度优先效果，因此应用必须模拟完整加载图。
- 循环、缺失、重复覆盖和符号链接都形成显式诊断。
- macOS 下 XDG 层先加载，Application Support 层后加载。

第一阶段完成单文件无损解析；第二阶段完成 include 图和有效值来源计算。

## 六、扩展机制

默认“插件”是声明式 extension pack，只允许贡献：

- 设置 metadata 和分类；
- 枚举、范围、正则等纯数据校验器；
- 预设与迁移映射；
- 无脚本的预览描述。

扩展包不能读取文件、联网或执行命令。安装时显示来源、SHA-256、请求能力和覆盖
范围；核心键覆盖仅允许受信任签名包。未来如确有可执行扩展需求，使用独立进程或
WASI 沙箱，默认无网络、无文件访问、有限 CPU/内存，并通过版本化 JSON-RPC 通信。

## 七、阶段与验收

### Phase 0：架构与安全基线

- ADR、威胁模型、插件模型、前后端 API 契约。
- Tauri capability 不授予通用 fs/shell 权限，CSP 禁止远程脚本。

### Phase 1：安全纵向切片

- 路径发现与 Ghostty 能力探测。
- 无损 AST、revision、diff、内部诊断。
- fixture 上的验证、备份、原子写入与冲突检测。
- UI 能打开 fixture、编辑、预览 diff、Apply/Undo。

### Phase 2：完整可视化体验

- 动态 schema、类别、搜索、typed controls。
- 主题/字体/快捷键管理器。
- DOM 终端预览；libghostty/WASM 作为可选增强，不能阻塞编辑。
- 配置来源图、托管覆盖层和 raw 专家视图。

### Phase 3：扩展与升级

- extension pack 校验、信任与兼容矩阵。
- schema 缓存与 Ghostty 升级差异报告。
- 迁移向导、配置 profile、dotfiles 友好模式。

### Phase 4：发布质量

- Rust 单元/集成测试、前端组件测试、端到端测试。
- fuzz/property tests 覆盖 parser round-trip。
- macOS 签名、公证和签名更新；Linux AppImage/deb/rpm。
- SBOM、依赖审计、固定 lockfile、可复现 CI 构建。

## 八、当前机器的实现约束

- Ghostty：1.3.1，位于 `/Applications/Ghostty.app/Contents/MacOS/ghostty`。
- Node：22.11.0；使用兼容该版本的 Vite 6，后续建议升级 LTS。
- Xcode/clang 已具备；已安装并固定 Rust 1.97.1、rustfmt 与 clippy。
- 自动测试使用临时目录和内存样例，不读取或写入真实配置内容。

## 九、当前实现进度（2026-08-04）

- **Phase 0 已完成：** 技术选型、ADR、威胁模型、CSP、窄 IPC 与声明式扩展契约。
- **Phase 1 已形成可运行纵向切片：** Ghostty 探测、无损文档、revision、官方校验、
  锁、快照、原子写入、验证失败回滚、原生确认与 UI review 流程。
- **Phase 2 部分完成：** 动态目录、搜索/分类、1.3.1 + schema-hash 版本化视觉控件、
  安全预览和脱敏 provenance 观察图已可用；完整 effective-value 引擎、快捷键、重复值、
  raw 专家编辑器和托管 overlay 尚未实现。
- **Phase 3 已完成基础契约：** extension manifest 有严格 schema、capability allowlist 和
  核心键覆盖规则；安装、签名信任库和升级差异 UI 尚未实现。
- **Phase 4 尚未完成：** 当前有 37 个 Rust 测试、17 个前端测试、clippy、生产构建、
  真实 Tauri 启动冒烟，以及通过严格完整性和 DMG 校验的 macOS ad-hoc 本地包；仍需
  fuzz、跨版本 fixture、Linux CI、Developer ID 签名、公证、SBOM 和更新器。

公开发布前还必须固定最终 bundle identifier，统一版本来源，完成 universal/架构支持
矩阵、Developer ID/notarization/stapling/Gatekeeper 验证和签名更新链路。
