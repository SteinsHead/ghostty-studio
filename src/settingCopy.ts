export const SETTING_COPY_LOCALES = ["zh-CN", "en"] as const;

export type SettingCopyLocale = typeof SETTING_COPY_LOCALES[number];

export interface SettingCopy {
  label: string;
  summary: string | null;
  detail: string | null;
}

interface LocalizedText {
  label: string;
  summary: string;
}

interface CatalogEntry {
  "zh-CN": LocalizedText;
  en: LocalizedText;
}

function entry(
  zhLabel: string,
  zhSummary: string,
  enLabel: string,
  enSummary: string,
): CatalogEntry {
  return {
    "zh-CN": { label: zhLabel, summary: zhSummary },
    en: { label: enLabel, summary: enSummary },
  };
}

/**
 * Product copy for the settings exposed by Ghostty 1.3.1. The installed
 * Ghostty documentation remains the factual source and is returned separately
 * as a short detail excerpt. This catalog only supplies a task-oriented name
 * and a concise description; it never grants an editor capability.
 */
const settingCatalog = {
  "abnormal-command-exit-runtime": entry("异常退出判定时长", "进程在该时长内退出时，将其视为异常退出。", "Abnormal exit threshold", "Treat a process as abnormal if it exits within this duration."),
  "adjust-box-thickness": entry("线框字符粗细", "调整方框绘制字符的线条粗细。", "Box drawing weight", "Adjust the stroke weight of box-drawing characters."),
  "adjust-cell-height": entry("单元格高度", "在字体测量结果上调整终端单元格高度。", "Cell height adjustment", "Adjust terminal cell height relative to the font metrics."),
  "adjust-cell-width": entry("单元格宽度", "在字体测量结果上调整终端单元格宽度。", "Cell width adjustment", "Adjust terminal cell width relative to the font metrics."),
  "adjust-cursor-height": entry("光标高度", "调整终端光标的高度。", "Cursor height", "Adjust the height of the terminal cursor."),
  "adjust-cursor-thickness": entry("光标粗细", "调整竖线和空心块光标的线条粗细。", "Cursor weight", "Adjust the stroke weight of bar and outlined cursors."),
  "adjust-font-baseline": entry("文字基线", "上下移动文字在单元格中的基线位置。", "Font baseline", "Move the text baseline within each terminal cell."),
  "adjust-icon-height": entry("图标字形高度", "调整 Nerd Font 等图标字形的最大高度。", "Icon glyph height", "Adjust the maximum height of icon glyphs such as Nerd Font symbols."),
  "adjust-overline-position": entry("上划线位置", "调整上划线在单元格中的垂直位置。", "Overline position", "Move the overline vertically within a terminal cell."),
  "adjust-overline-thickness": entry("上划线粗细", "调整上划线的线条粗细。", "Overline weight", "Adjust the stroke weight of overlines."),
  "adjust-strikethrough-position": entry("删除线位置", "调整删除线在单元格中的垂直位置。", "Strikethrough position", "Move the strikethrough vertically within a terminal cell."),
  "adjust-strikethrough-thickness": entry("删除线粗细", "调整删除线的线条粗细。", "Strikethrough weight", "Adjust the stroke weight of strikethroughs."),
  "adjust-underline-position": entry("下划线位置", "调整下划线在单元格中的垂直位置。", "Underline position", "Move the underline vertically within a terminal cell."),
  "adjust-underline-thickness": entry("下划线粗细", "调整下划线的线条粗细。", "Underline weight", "Adjust the stroke weight of underlines."),
  "alpha-blending": entry("透明混合色彩空间", "选择文字和透明图像进行透明混合时使用的色彩空间。", "Alpha blending color space", "Choose the color space used to blend text and transparent images."),
  "app-notifications": entry("应用内通知", "控制 Ghostty 自身显示哪些应用内通知。", "In-app notifications", "Choose which notifications Ghostty shows inside the app."),
  "async-backend": entry("异步 I/O 后端", "选择 Ghostty 底层异步 I/O 与事件后端；多数用户应保持自动。", "Async I/O backend", "Choose the low-level async I/O and event backend; auto is best for most users."),
  "auto-update": entry("自动更新", "选择关闭更新、仅检查，或自动下载；安装仍由你确认。", "Automatic updates", "Choose off, check only, or automatic download; installation remains manual."),
  "auto-update-channel": entry("更新通道", "选择 Ghostty 自动更新使用的发布通道。", "Update channel", "Choose the release channel used for automatic updates."),
  background: entry("背景色", "终端背景色。", "Background color", "Set the terminal window background color."),
  "background-blur": entry("背景模糊", "在终端背景透明时应用背景模糊。", "Background blur", "Apply background blur when the terminal background is transparent."),
  "background-blur-radius": entry("背景模糊强度", "调整透明背景的模糊强度。", "Background blur strength", "Adjust the blur strength used behind a transparent terminal."),
  "background-image": entry("背景图片", "使用本地 PNG 或 JPEG 文件作为终端背景。", "Background image", "Use a local PNG or JPEG file as the terminal background."),
  "background-image-fit": entry("背景图片适配方式", "选择背景图片如何适应终端区域。", "Background image fit", "Choose how the background image fits the terminal area."),
  "background-image-opacity": entry("背景图片不透明度", "调整背景图片相对于窗口背景的可见程度。", "Background image opacity", "Adjust how visible the background image is relative to the window background."),
  "background-image-position": entry("背景图片位置", "选择背景图片在终端区域中的对齐位置。", "Background image position", "Choose where the background image is aligned in the terminal."),
  "background-image-repeat": entry("平铺背景图片", "图片未填满终端时重复显示。", "Tile background image", "Repeat the image when it does not fill the terminal."),
  "background-opacity": entry("背景不透明度", "数值越低，终端背景越透明。", "Background opacity", "Lower values make the terminal background more transparent."),
  "background-opacity-cells": entry("同步单元格透明度", "让带背景色的终端内容也使用窗口不透明度。", "Apply opacity to cells", "Apply window opacity to cells with their own background color."),
  "bell-audio-path": entry("响铃音频", "选择终端声音响铃播放的本地音频文件。", "Bell sound file", "Choose the local audio file played for an audible terminal bell."),
  "bell-audio-volume": entry("响铃音量", "调整终端声音响铃相对于系统音量的大小。", "Bell volume", "Adjust audible bell volume relative to the system volume."),
  "bell-features": entry("响铃反馈", "选择终端响铃触发声音、系统提示等哪些反馈。", "Bell feedback", "Choose which feedback, such as sound or system alerts, a terminal bell triggers."),
  "bold-color": entry("粗体文字颜色", "选择粗体文字使用固定颜色还是调亮后的颜色。", "Bold text color", "Choose how bold terminal text gets its color."),
  class: entry("GTK 应用标识", "设置 X11 WM_CLASS、Wayland 应用 ID 和 D-Bus 名称。", "GTK application ID", "Set the X11 WM_CLASS, Wayland application ID, and D-Bus name."),
  "click-repeat-interval": entry("连续点击间隔", "设置多次点击被识别为双击或三击的最长间隔。", "Multi-click interval", "Set the maximum interval for clicks to count as a double or triple click."),
  "clipboard-codepoint-map": entry("复制字符替换", "复制文本时将指定 Unicode 字符替换为其他字符或文本。", "Copied character mapping", "Replace selected Unicode characters when text is copied."),
  "clipboard-paste-bracketed-safe": entry("括号粘贴视为安全", "决定括号粘贴是否跳过不安全内容确认。", "Trust bracketed paste", "Choose whether bracketed paste can skip unsafe-content confirmation."),
  "clipboard-paste-protection": entry("粘贴保护", "粘贴疑似危险文本前要求确认。", "Paste protection", "Ask for confirmation before pasting text that appears unsafe."),
  "clipboard-read": entry("剪贴板读取", "控制终端程序能否读取系统剪贴板。", "Clipboard read access", "Control whether terminal programs can read the system clipboard."),
  "clipboard-trim-trailing-spaces": entry("移除复制行尾空格", "复制终端文本时移除每行末尾的空白。", "Trim copied trailing spaces", "Remove trailing whitespace from terminal text when it is copied."),
  "clipboard-write": entry("剪贴板写入", "控制终端程序能否写入系统剪贴板。", "Clipboard write access", "Control whether terminal programs can write to the system clipboard."),
  command: entry("启动命令", "设置每个新终端通常启动的命令或 Shell。", "Launch command", "Set the command or shell normally started in each new terminal."),
  "command-palette-entry": entry("命令面板条目", "向 Ghostty 命令面板添加自定义操作。", "Command palette entry", "Add a custom action to Ghostty's command palette."),
  "config-default-files": entry("加载默认配置文件", "控制 Ghostty 是否读取默认位置中的配置文件。", "Load default config files", "Choose whether Ghostty loads config files from its default locations."),
  "config-file": entry("附加配置文件", "按顺序加载一个或多个额外配置文件。", "Additional config file", "Load one or more additional configuration files in order."),
  "confirm-close-surface": entry("关闭终端前确认", "控制关闭仍有运行内容的终端前是否要求确认。", "Confirm before closing", "Choose whether Ghostty asks before closing a terminal surface."),
  "copy-on-select": entry("选中即复制", "选中文字后自动复制到剪贴板。", "Copy on select", "Copy terminal text to the clipboard as soon as it is selected."),
  "cursor-click-to-move": entry("点击移动光标", "在受支持的 Shell 提示符中点击文字位置来移动光标。", "Click to move cursor", "Move the prompt cursor by clicking a supported position in the text."),
  "cursor-color": entry("光标颜色", "设置终端光标颜色；留空时由 Ghostty 选择。", "Cursor color", "Set the terminal cursor color, or let Ghostty choose it."),
  "cursor-opacity": entry("光标不透明度", "控制光标从完全透明到完全不透明的可见程度。", "Cursor opacity", "Control cursor visibility from fully transparent to fully opaque."),
  "cursor-style": entry("光标形状", "设置默认光标形状；终端程序仍可临时覆盖。", "Cursor shape", "Set the default cursor shape; terminal programs may still override it."),
  "cursor-style-blink": entry("光标闪烁", "设置光标默认是否闪烁；终端程序仍可覆盖。", "Cursor blinking", "Choose whether the cursor blinks by default; terminal programs may override it."),
  "cursor-text": entry("光标下文字颜色", "设置块状光标覆盖文字时的文字颜色。", "Text under cursor", "Set the text color shown underneath a block cursor."),
  "custom-shader": entry("自定义着色器", "在默认渲染后加载本地 GLSL 着色器。", "Custom shader", "Run a local GLSL shader after Ghostty's default rendering."),
  "custom-shader-animation": entry("着色器动画", "使用自定义着色器时控制是否持续刷新动画。", "Shader animation", "Choose whether custom shaders run a continuous animation loop."),
  "desktop-notifications": entry("终端桌面通知", "允许终端程序通过受支持的转义序列发送桌面通知。", "Terminal desktop notifications", "Allow terminal programs to send desktop notifications through supported escape sequences."),
  "enquiry-response": entry("ENQ 响应", "设置终端收到 ENQ 控制字符时返回的文本。", "ENQ response", "Set the text returned when the terminal receives an ENQ control character."),
  env: entry("环境变量", "为终端启动的命令添加环境变量。", "Environment variables", "Add environment variables to commands launched in the terminal."),
  "faint-opacity": entry("淡色文字不透明度", "调整终端淡色文字的可见程度。", "Faint text opacity", "Adjust the visibility of terminal text marked as faint."),
  "focus-follows-mouse": entry("鼠标移入时聚焦", "鼠标移入另一个终端时自动移动焦点。", "Focus follows pointer", "Focus a terminal when the pointer moves over it."),
  "font-codepoint-map": entry("字符字体映射", "让指定 Unicode 字符或范围使用特定字体。", "Character font mapping", "Render selected Unicode characters or ranges with a specific font."),
  "font-family": entry("字体", "选择主要终端字体，并按顺序配置备用字体。", "Font family", "Choose the primary terminal font and ordered fallback fonts."),
  "font-family-bold": entry("粗体字体", "为粗体文字指定字体；留空时从常规字体寻找粗体样式。", "Bold font family", "Choose a font for bold text, or derive it from the regular family."),
  "font-family-bold-italic": entry("粗斜体字体", "为粗斜体文字指定字体；留空时从常规字体寻找对应样式。", "Bold italic font family", "Choose a font for bold italic text, or derive it from the regular family."),
  "font-family-italic": entry("斜体字体", "为斜体文字指定字体；留空时从常规字体寻找斜体样式。", "Italic font family", "Choose a font for italic text, or derive it from the regular family."),
  "font-feature": entry("字体特性", "启用、关闭或调整 OpenType 字体特性。", "Font features", "Enable, disable, or configure OpenType font features."),
  "font-shaping-break": entry("字体塑形分段", "选择文本塑形应在哪些边界拆分，以调整连字等行为。", "Font shaping boundaries", "Choose where text shaping is split into runs, affecting behavior such as ligatures."),
  "font-size": entry("字号", "设置终端字号，单位为磅（pt），支持小数。", "Font size", "Set the terminal font size in points, including fractional sizes."),
  "font-style": entry("常规字体样式", "为常规文字选择字体内部声明的具体样式。", "Regular font style", "Choose the named font face used for regular text."),
  "font-style-bold": entry("粗体样式", "为粗体文字选择字体内部声明的具体样式。", "Bold font style", "Choose the named font face used for bold text."),
  "font-style-bold-italic": entry("粗斜体样式", "为粗斜体文字选择字体内部声明的具体样式。", "Bold italic font style", "Choose the named font face used for bold italic text."),
  "font-style-italic": entry("斜体样式", "为斜体文字选择字体内部声明的具体样式。", "Italic font style", "Choose the named font face used for italic text."),
  "font-synthetic-style": entry("合成字体样式", "控制缺少原生字形时是否合成粗体或斜体。", "Synthetic font styles", "Choose whether Ghostty synthesizes bold or italic when a font lacks those faces."),
  "font-thicken": entry("增强字体笔画", "让 macOS 上的文字笔画更饱满。", "Thicken text strokes", "Make text strokes fuller on macOS."),
  "font-thicken-strength": entry("笔画增强程度", "调整文字笔画增强的幅度。", "Stroke thickness", "Adjust how much text strokes are thickened."),
  "font-variation": entry("可变字体轴", "为常规可变字体设置字重、宽度等轴值。", "Variable font axes", "Set weight, width, and other axes for the regular variable font."),
  "font-variation-bold": entry("粗体可变轴", "为粗体可变字体设置轴值。", "Bold variable font axes", "Set variable font axes for bold text."),
  "font-variation-bold-italic": entry("粗斜体可变轴", "为粗斜体可变字体设置轴值。", "Bold italic variable font axes", "Set variable font axes for bold italic text."),
  "font-variation-italic": entry("斜体可变轴", "为斜体可变字体设置轴值。", "Italic variable font axes", "Set variable font axes for italic text."),
  foreground: entry("文字颜色", "设置终端默认文字颜色。", "Text color", "Set the default terminal text color."),
  "freetype-load-flags": entry("FreeType 加载选项", "调整 FreeType 加载字体时使用的渲染选项。", "FreeType load options", "Choose the rendering flags FreeType uses when loading fonts."),
  fullscreen: entry("启动时全屏", "让新窗口启动时进入全屏。", "Start in fullscreen", "Open new Ghostty windows in fullscreen."),
  "grapheme-width-method": entry("字素宽度算法", "选择如何计算组合字符在终端中占用的单元格宽度。", "Grapheme width method", "Choose how terminal cell width is calculated for grapheme clusters."),
  "gtk-custom-css": entry("GTK 自定义样式", "为 GTK 版 Ghostty 加载本地 CSS 文件。", "GTK custom CSS", "Load local CSS files into the GTK version of Ghostty."),
  "gtk-opengl-debug": entry("GTK OpenGL 调试", "控制 GTK OpenGL 调试日志。", "GTK OpenGL debugging", "Control GTK OpenGL debug logging."),
  "gtk-quick-terminal-layer": entry("快速终端显示层级", "选择 GTK Wayland 快速终端相对于其他窗口的显示层级。", "Quick terminal layer", "Choose where the GTK Wayland quick terminal sits relative to other windows."),
  "gtk-quick-terminal-namespace": entry("快速终端命名空间", "设置 GTK 快速终端供 Wayland 合成器识别的命名空间。", "Quick terminal namespace", "Set the namespace exposed by the GTK quick terminal to the Wayland compositor."),
  "gtk-single-instance": entry("GTK 单实例模式", "让后续启动请求复用正在运行的 GTK 应用实例。", "GTK single-instance mode", "Route later launches through the running GTK application instance."),
  "gtk-tabs-location": entry("GTK 标签栏位置", "选择 GTK 标签栏显示在顶部、底部或隐藏。", "GTK tab bar position", "Place the GTK tab bar at the top, bottom, or hide it."),
  "gtk-titlebar": entry("GTK 完整标题栏", "选择使用 Ghostty 的完整 GTK 标题栏还是窗口管理器标题栏。", "GTK full titlebar", "Choose between Ghostty's full GTK titlebar and the window manager titlebar."),
  "gtk-titlebar-hide-when-maximized": entry("最大化时隐藏标题栏", "GTK 窗口最大化时隐藏标题栏。", "Hide maximized titlebar", "Hide the GTK titlebar while the window is maximized."),
  "gtk-titlebar-style": entry("GTK 标题栏样式", "选择 GTK 标题栏的布局样式。", "GTK titlebar style", "Choose the layout style of the GTK titlebar."),
  "gtk-toolbar-style": entry("GTK 工具栏样式", "选择 GTK 顶部与底部栏的外观。", "GTK toolbar style", "Choose the appearance of GTK top and bottom bars."),
  "gtk-wide-tabs": entry("GTK 宽标签页", "让 GTK 标签页均匀占用可用宽度。", "GTK wide tabs", "Let GTK tabs expand evenly across the available width."),
  "image-storage-limit": entry("图片存储上限", "限制每个终端屏幕可用于图像协议的数据量。", "Image storage limit", "Limit image-protocol storage for each terminal screen."),
  "initial-command": entry("首次启动命令", "仅为 Ghostty 启动时创建的第一个终端设置命令。", "Initial launch command", "Set the command used only by the first terminal created at startup."),
  "initial-window": entry("创建初始窗口", "控制启动 Ghostty 时是否自动创建第一个窗口。", "Create initial window", "Choose whether Ghostty creates a window when the app starts."),
  input: entry("启动输入", "终端命令启动后向其标准输入发送预设数据。", "Startup input", "Send predefined data to the launched command's standard input."),
  "key-remap": entry("修饰键重映射", "仅在 Ghostty 内交换或重新分配修饰键。", "Modifier key remapping", "Swap or reassign modifier keys inside Ghostty without changing system settings."),
  keybind: entry("快捷键", "将键盘触发组合映射到 Ghostty 操作。", "Keyboard shortcuts", "Map key combinations to Ghostty actions."),
  language: entry("界面语言", "选择 Ghostty 图形界面使用的语言，不影响终端内程序。", "Interface language", "Choose Ghostty's interface language without changing programs inside the terminal."),
  "link-previews": entry("链接预览", "控制匹配链接是否显示预览。", "Link previews", "Choose whether matched links show a preview."),
  "link-url": entry("网址识别", "控制是否自动识别终端中的 URL，并用系统默认应用打开。", "URL detection", "Enable built-in URL detection and open matches with the system handler."),
  "linux-cgroup": entry("Linux cgroup 隔离", "将每个终端表面放入独立的 systemd 临时作用域。", "Linux cgroup isolation", "Place each terminal surface in its own transient systemd scope."),
  "linux-cgroup-hard-fail": entry("cgroup 失败策略", "决定无法创建 systemd 作用域时是否阻止终端启动。", "cgroup failure policy", "Choose whether a failed systemd scope prevents the terminal from starting."),
  "linux-cgroup-memory-limit": entry("终端内存软阈值", "为每个 Linux 终端设置 systemd MemoryHigh 软限制。", "Terminal memory threshold", "Set the systemd MemoryHigh soft limit for each Linux terminal scope."),
  "linux-cgroup-processes-limit": entry("终端进程数上限", "限制单个 Linux 终端进程组可创建的进程数。", "Terminal process limit", "Limit the number of processes in each Linux terminal process group."),
  "macos-applescript": entry("AppleScript 控制", "允许 Ghostty 响应内置 AppleScript 指令。", "AppleScript control", "Allow Ghostty to respond to its built-in AppleScript commands."),
  "macos-auto-secure-input": entry("自动安全输入", "检测到密码提示时自动启用 macOS 安全输入。", "Automatic secure input", "Enable macOS Secure Input automatically around detected password prompts."),
  "macos-custom-icon": entry("自定义应用图标文件", "选择本地 PNG、JPEG 或 ICNS 文件作为 macOS 应用图标。", "Custom app icon file", "Choose a local PNG, JPEG, or ICNS file for the macOS app icon."),
  "macos-dock-drop-behavior": entry("Dock 拖放行为", "选择把文件或文件夹拖到 Dock 图标时如何打开。", "Dock drop behavior", "Choose how Ghostty opens files or folders dropped on its Dock icon."),
  "macos-hidden": entry("隐藏 Dock 图标", "从 Dock 与应用切换器隐藏 Ghostty，适合以快速终端为主的用法。", "Hide Dock icon", "Hide Ghostty from the Dock and app switcher for quick-terminal-focused workflows."),
  "macos-icon": entry("macOS 应用图标", "选择 Ghostty 在 Dock 和应用切换器中使用的图标样式。", "macOS app icon", "Choose the Ghostty icon shown in the Dock and app switcher."),
  "macos-icon-frame": entry("应用图标边框材质", "选择 macOS Ghostty 图标边框的材质。", "App icon frame", "Choose the material used for the macOS app icon frame."),
  "macos-icon-ghost-color": entry("应用图标幽灵颜色", "设置自定义 macOS 应用图标中幽灵的颜色。", "App icon ghost color", "Set the ghost color in a custom macOS app icon."),
  "macos-icon-screen-color": entry("应用图标屏幕颜色", "设置自定义 macOS 应用图标中屏幕的颜色或渐变。", "App icon screen color", "Set the screen color or gradient in a custom macOS app icon."),
  "macos-non-native-fullscreen": entry("非原生全屏", "在 macOS 上使用无系统切换动画的非原生全屏模式。", "Non-native fullscreen", "Use a non-native macOS fullscreen mode without the system transition."),
  "macos-option-as-alt": entry("Option 键作为 Alt", "控制 macOS Option 键在终端中何时作为 Alt 使用。", "Use Option as Alt", "Choose when the macOS Option key acts as Alt inside the terminal."),
  "macos-secure-input-indication": entry("安全输入提示", "启用 macOS 安全输入时显示可见提示。", "Secure input indicator", "Show a visible indicator while macOS Secure Input is active."),
  "macos-shortcuts": entry("快捷指令控制", "允许 macOS 快捷指令调用 Ghostty 操作。", "Shortcuts control", "Allow macOS Shortcuts to invoke Ghostty actions."),
  "macos-titlebar-proxy-icon": entry("标题栏代理图标", "显示代表当前工作目录的 macOS 标题栏代理图标。", "Titlebar proxy icon", "Show the macOS titlebar icon representing the current working directory."),
  "macos-titlebar-style": entry("macOS 标题栏样式", "选择 macOS 窗口标题栏的布局和外观。", "macOS titlebar style", "Choose the layout and appearance of the macOS window titlebar."),
  "macos-window-buttons": entry("窗口控制按钮", "控制 macOS 标题栏红黄绿窗口按钮是否可见。", "Window control buttons", "Show or hide the macOS red, yellow, and green window buttons."),
  "macos-window-shadow": entry("窗口阴影", "控制 macOS Ghostty 窗口是否显示系统阴影。", "Window shadow", "Show or hide the system shadow around macOS Ghostty windows."),
  maximize: entry("启动时最大化", "让新窗口启动时最大化。", "Start maximized", "Open new Ghostty windows maximized."),
  "minimum-contrast": entry("最低文字对比度", "自动改善对比度不足的文字；数值越高越清晰。", "Minimum text contrast", "Improve text with insufficient contrast; higher values increase readability."),
  "mouse-hide-while-typing": entry("输入时隐藏指针", "键盘输入时隐藏鼠标指针，再次使用鼠标时恢复。", "Hide pointer while typing", "Hide the pointer while typing and reveal it when the mouse is used again."),
  "mouse-reporting": entry("鼠标事件上报", "控制终端程序能否接收鼠标事件。", "Mouse reporting", "Control whether terminal programs receive mouse events."),
  "mouse-scroll-multiplier": entry("滚动速度倍率", "调整鼠标滚轮或触控板发送的滚动距离。", "Scroll distance multiplier", "Adjust scrolling distance from a mouse wheel or trackpad."),
  "mouse-shift-capture": entry("Shift 点击传递", "决定终端程序能否接收带 Shift 的鼠标点击。", "Shift-click capture", "Choose whether terminal programs receive mouse clicks made with Shift."),
  "notify-on-command-finish": entry("命令完成通知时机", "选择从不通知、仅在终端未聚焦时通知，或始终通知。", "Command completion notifications", "Choose never, only when unfocused, or always."),
  "notify-on-command-finish-action": entry("命令通知方式", "选择命令完成时如何提醒你。", "Command notification style", "Choose how Ghostty alerts you when a command finishes."),
  "notify-on-command-finish-after": entry("命令通知延迟", "只通知运行时间达到指定时长的命令。", "Command notification threshold", "Notify only for commands that run at least this long."),
  "osc-color-report-format": entry("OSC 颜色报告格式", "选择终端程序查询颜色时 Ghostty 返回的格式。", "OSC color report format", "Choose the format Ghostty returns when terminal programs query colors."),
  palette: entry("终端调色板", "设置终端 256 色调色板中的指定颜色。", "Terminal color palette", "Set individual colors in the terminal's 256-color palette."),
  "palette-generate": entry("自动生成扩展调色板", "从基础 16 色自动生成调色板的其余颜色。", "Generate extended palette", "Generate the remaining terminal palette colors from the base 16 colors."),
  "palette-harmonious": entry("反转生成调色板", "反转自动生成调色板的颜色顺序。", "Reverse generated palette", "Reverse the order of automatically generated palette colors."),
  "progress-style": entry("图形进度提示", "允许终端程序通过受支持的序列显示图形进度。", "Graphical progress", "Allow terminal programs to show graphical progress through supported sequences."),
  "quick-terminal-animation-duration": entry("快速终端动画时长", "调整快速终端显示和隐藏动画的时长。", "Quick terminal animation", "Set how long the quick terminal’s show and hide animations take."),
  "quick-terminal-autohide": entry("快速终端自动隐藏", "快速终端失去焦点时自动隐藏。", "Auto-hide quick terminal", "Hide the quick terminal automatically when it loses focus."),
  "quick-terminal-keyboard-interactivity": entry("快速终端键盘交互", "选择快速终端在什么情况下接收键盘输入。", "Quick terminal keyboard input", "Choose when the quick terminal receives keyboard input."),
  "quick-terminal-position": entry("快速终端位置", "选择快速终端从屏幕哪一侧出现。", "Quick terminal position", "Choose where the quick terminal appears on screen."),
  "quick-terminal-screen": entry("快速终端显示器", "选择快速终端在哪台显示器上出现。", "Quick terminal display", "Choose which display shows the quick terminal."),
  "quick-terminal-space-behavior": entry("快速终端空间行为", "控制快速终端在 macOS 桌面空间之间的显示方式。", "Quick terminal Space behavior", "Control how the quick terminal behaves across macOS Spaces."),
  "quit-after-last-window-closed": entry("关闭最后一个窗口后退出", "控制最后一个终端表面关闭后是否退出 Ghostty。", "Quit after last window", "Choose whether Ghostty quits after its last terminal surface closes."),
  "quit-after-last-window-closed-delay": entry("关闭最后一个窗口后的退出延迟", "最后一个终端关闭后等待一段时间再退出。", "Quit delay after last window", "Wait before quitting after the last terminal surface closes."),
  "resize-overlay": entry("调整尺寸提示", "控制调整终端大小时是否显示尺寸浮层。", "Resize overlay", "Choose when a size overlay appears while resizing the terminal."),
  "resize-overlay-duration": entry("尺寸提示时长", "设置调整尺寸浮层保持可见的时间。", "Resize overlay duration", "Set how long the resize overlay remains visible."),
  "resize-overlay-position": entry("尺寸提示位置", "选择调整尺寸浮层在窗口中的位置。", "Resize overlay position", "Choose where the resize overlay appears in the window."),
  "right-click-action": entry("右键操作", "选择右键点击终端时执行的操作。", "Right-click action", "Choose what happens when you right-click the terminal."),
  "scroll-to-bottom": entry("自动滚动到底部", "选择哪些输入或输出事件会把终端滚动到底部。", "Scroll to bottom", "Choose which input or output events scroll the terminal to the bottom."),
  "scrollback-limit": entry("回滚缓冲区上限", "限制每个终端用于回看历史内容的内存。", "Scrollback limit", "Limit memory used for each terminal's scrollback history."),
  scrollbar: entry("滚动条", "选择终端回滚区何时显示滚动条。", "Scrollbar", "Choose when the terminal shows a scrollbar for scrollback."),
  "search-background": entry("搜索结果背景色", "设置未选中搜索匹配项的背景颜色。", "Search match background", "Set the background color of non-selected search matches."),
  "search-foreground": entry("搜索结果文字颜色", "设置未选中搜索匹配项的文字颜色。", "Search match text", "Set the text color of non-selected search matches."),
  "search-selected-background": entry("当前搜索结果背景色", "设置当前选中搜索匹配项的背景颜色。", "Selected match background", "Set the background color of the selected search match."),
  "search-selected-foreground": entry("当前搜索结果文字颜色", "设置当前选中搜索匹配项的文字颜色。", "Selected match text", "Set the text color of the selected search match."),
  "selection-background": entry("选区背景颜色", "设置选中文字的背景颜色；留空时由 Ghostty 选择。", "Selection background", "Set the selected-text background color, or let Ghostty choose it."),
  "selection-clear-on-copy": entry("复制后清除选区", "使用复制命令后清除选区；选中即复制不受影响。", "Clear selection after copy", "Clear the selection after a copy command; copy-on-select is unaffected."),
  "selection-clear-on-typing": entry("输入时清除选区", "开始键盘输入时自动取消当前选区。", "Clear selection when typing", "Clear the current selection when keyboard input begins."),
  "selection-foreground": entry("选区文字颜色", "设置选中文字的前景颜色；留空时由 Ghostty 选择。", "Selection text", "Set the selected text color, or let Ghostty choose it."),
  "selection-word-chars": entry("单词分隔字符", "设置双击选择单词时用于划分边界的字符。", "Word boundary characters", "Set which characters stop word selection on actions such as double-click."),
  "shell-integration": entry("Shell 集成", "控制是否自动加载 Ghostty 的 Shell 集成功能。", "Shell integration", "Choose whether Ghostty injects its shell integration automatically."),
  "shell-integration-features": entry("Shell 集成功能", "选择已加载的 Shell 集成启用哪些能力。", "Shell integration features", "Choose which features are enabled by the loaded shell integration."),
  "split-divider-color": entry("分屏线颜色", "设置分屏之间分隔线的颜色。", "Split divider color", "Set the divider color between split panes."),
  "split-inherit-working-directory": entry("分屏继承目录", "让新分屏沿用当前分屏的工作目录。", "Splits inherit directory", "Open new splits in the working directory of the focused split."),
  "split-preserve-zoom": entry("保留分屏缩放", "选择哪些布局或焦点操作保留当前放大的分屏。", "Preserve split zoom", "Choose which focus or layout actions keep the current split zoomed."),
  "tab-inherit-working-directory": entry("标签页继承目录", "让新标签页沿用当前标签页的工作目录。", "Tabs inherit directory", "Open new tabs in the working directory of the focused tab."),
  term: entry("TERM 标识", "设置传递给终端程序的 TERM 环境变量。", "TERM value", "Set the TERM environment value passed to terminal programs."),
  theme: entry("主题", "选择内置主题、自定义主题或分别设置浅色与深色主题。", "Theme", "Choose a built-in or custom theme, including separate light and dark themes."),
  title: entry("固定窗口标题", "始终使用指定窗口标题，并忽略终端程序的标题请求。", "Fixed window title", "Keep a fixed window title and ignore title changes requested by terminal programs."),
  "title-report": entry("标题查询报告", "控制终端程序能否查询当前窗口标题。", "Title reporting", "Control whether terminal programs can query the current window title."),
  "undo-timeout": entry("撤销保留时间", "设置关闭标签页等操作可被撤销的时长。", "Undo availability", "Set how long closed surfaces and other operations remain undoable."),
  "unfocused-split-fill": entry("未聚焦分屏遮罩色", "设置用于弱化未聚焦分屏的遮罩颜色。", "Unfocused split tint", "Set the tint used to dim an unfocused split pane."),
  "unfocused-split-opacity": entry("未聚焦分屏不透明度", "调整未聚焦分屏的可见程度。", "Unfocused split opacity", "Adjust the visibility of unfocused split panes."),
  "vt-kam-allowed": entry("允许键盘锁定模式", "允许终端程序通过 KAM 模式暂时禁用键盘输入。", "Allow Keyboard Action Mode", "Allow terminal programs to disable keyboard input through KAM."),
  "wait-after-command": entry("命令结束后保留终端", "命令退出后保持终端打开。", "Keep terminal after exit", "Keep the terminal open after its command exits."),
  "window-colorspace": entry("窗口色彩空间", "选择解释和渲染终端颜色时使用的色彩空间。", "Window color space", "Choose the color space used to interpret and render terminal colors."),
  "window-decoration": entry("窗口装饰", "向系统表达标题栏和边框等窗口装饰偏好。", "Window decorations", "Set Ghostty's preference for system titlebars, borders, and other decorations."),
  "window-height": entry("初始窗口高度", "设置新窗口的初始高度；通常以终端行数表示。", "Initial window height", "Set the initial height of new windows, usually in terminal rows."),
  "window-inherit-font-size": entry("窗口继承字号", "让新窗口和标签页沿用最近聚焦窗口的字号。", "Windows inherit font size", "Use the focused window's font size for new windows and tabs."),
  "window-inherit-working-directory": entry("窗口继承目录", "让新窗口沿用最近聚焦窗口的工作目录。", "Windows inherit directory", "Open new windows in the working directory of the focused window."),
  "window-new-tab-position": entry("新标签页位置", "选择新标签页插入标签栏的位置。", "New tab position", "Choose where new tabs are inserted in the tab bar."),
  "window-padding-balance": entry("自动平衡窗口边距", "让终端四周的留白更均匀。", "Balance window padding", "Distribute unused space evenly around the terminal."),
  "window-padding-color": entry("窗口留白颜色", "选择终端网格周围留白区域使用的颜色。", "Window padding color", "Choose the color used around the terminal grid."),
  "window-padding-x": entry("水平窗口留白", "设置终端内容与窗口左右边缘的间距。", "Horizontal window padding", "Set spacing between terminal content and the left and right window edges."),
  "window-padding-y": entry("垂直窗口留白", "设置终端内容与窗口上下边缘的间距。", "Vertical window padding", "Set spacing between terminal content and the top and bottom window edges."),
  "window-position-x": entry("初始窗口横坐标", "设置新窗口相对主显示器左上角的水平位置。", "Initial window X position", "Set the horizontal starting position of new windows on the primary display."),
  "window-position-y": entry("初始窗口纵坐标", "设置新窗口相对主显示器左上角的垂直位置。", "Initial window Y position", "Set the vertical starting position of new windows on the primary display."),
  "window-save-state": entry("保存窗口状态", "保存并恢复窗口位置、尺寸、标签页和分屏等状态。", "Save window state", "Save and restore window position, size, tabs, splits, and related state."),
  "window-show-tab-bar": entry("显示标签栏", "选择标签栏何时可见。", "Show tab bar", "Choose when the window tab bar is visible."),
  "window-step-resize": entry("按字符调整窗口", "在 macOS 上按整行整列改变窗口大小。", "Step-resize by cell", "Resize macOS windows in whole character-cell steps."),
  "window-subtitle": entry("窗口副标题", "选择窗口副标题显示的上下文信息，或将其关闭。", "Window subtitle", "Choose what context appears in the window subtitle, or hide it."),
  "window-theme": entry("窗口主题", "选择 Ghostty 窗口界面的浅色或深色外观。", "Window theme", "Choose the light or dark appearance of Ghostty window chrome."),
  "window-title-font-family": entry("窗口标题字体", "设置窗口和标签页标题使用的字体。", "Window title font", "Set the font used for window and tab titles."),
  "window-titlebar-background": entry("标题栏背景色", "为支持的 GTK Ghostty 标题栏设置背景颜色。", "Titlebar background", "Set the titlebar background color for supported GTK windows."),
  "window-titlebar-foreground": entry("标题栏文字颜色", "为支持的 GTK Ghostty 标题栏设置文字颜色。", "Titlebar text color", "Set the titlebar text color for supported GTK windows."),
  "window-vsync": entry("垂直同步", "让渲染与屏幕刷新率同步，以减少画面撕裂。", "Vertical sync", "Synchronize rendering with the display refresh rate to reduce tearing."),
  "window-width": entry("初始窗口宽度", "设置新窗口的初始宽度；通常以终端列数表示。", "Initial window width", "Set the initial width of new windows, usually in terminal columns."),
  "working-directory": entry("启动目录", "设置终端命令启动后的工作目录。", "Working directory", "Set the working directory used when a terminal command starts."),
  "x11-instance-name": entry("X11 实例名", "设置 Linux X11 窗口的应用实例标识。", "X11 instance name", "Set the application instance name reported by Ghostty windows on X11."),
} satisfies Record<string, CatalogEntry>;

export const localizedSettingKeys = Object.freeze(Object.keys(settingCatalog));

export function resolveSettingCopyLocale(locale?: string | null): SettingCopyLocale {
  return locale?.toLocaleLowerCase().startsWith("en") ? "en" : "zh-CN";
}

function normalizedOfficialDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

function firstSentence(description: string): string {
  const sentenceEnd = description.search(/[.!?](?:\s|$)/);
  const sentence = sentenceEnd >= 0
    ? description.slice(0, sentenceEnd + 1)
    : description;
  if (sentence.length <= 180) return sentence;

  const shortened = sentence.slice(0, 180);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 120 ? lastSpace : 180).trimEnd()}…`;
}

function officialExcerpt(description: string): string {
  if (description.length <= 180) return description;
  const shortened = description.slice(0, 180);
  const lastSentence = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("! "),
    shortened.lastIndexOf("? "),
  );
  if (lastSentence >= 100) return shortened.slice(0, lastSentence + 1).trimEnd();
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 120 ? lastSpace : 180).trimEnd()}…`;
}

function officialDetail(official: string, summary: string): string | null {
  if (!official || official === summary) return null;
  return officialExcerpt(official);
}

export function copyForSetting(
  locale: SettingCopyLocale,
  key: string,
  description: string,
): SettingCopy;
export function copyForSetting(
  key: string,
  description: string,
  locale?: SettingCopyLocale,
): SettingCopy;
export function copyForSetting(
  first: string,
  second: string,
  third?: string,
): SettingCopy {
  const localeFirst = third !== undefined
    && SETTING_COPY_LOCALES.includes(first as SettingCopyLocale);
  const key = localeFirst ? second : first;
  const description = localeFirst ? third : second;
  const locale = resolveSettingCopyLocale(localeFirst ? first : third);
  const official = normalizedOfficialDescription(description);
  const catalogEntry = settingCatalog[key as keyof typeof settingCatalog];
  if (catalogEntry) {
    const localized = catalogEntry[locale] ?? catalogEntry["zh-CN"];
    return {
      label: localized.label,
      summary: localized.summary,
      detail: officialDetail(official, localized.summary),
    };
  }

  if (!official) return { label: key, summary: null, detail: null };
  const summary = firstSentence(official);
  return {
    label: key,
    summary,
    detail: officialDetail(official, summary),
  };
}
