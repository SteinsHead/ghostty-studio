import { isGenericallyEditable } from "./productModel";
import { textForLocale, type AppLocale } from "./i18n";
import type { ConfigCandidate, ConfiguredSetting, RuntimeOption } from "./types";

export const CATEGORY_IDS = [
  "appearance",
  "font",
  "window",
  "cursor",
  "mouse-scroll",
  "keyboard",
  "quick-terminal",
  "privacy-security",
  "shell-environment",
  "macos",
  "linux-gtk",
  "advanced",
  "unknown",
] as const;

const legacyCategoryIds: Record<string, string> = {
  "外观": "appearance",
  "字体": "font",
  "窗口": "window",
  "光标": "cursor",
  "鼠标与滚动": "mouse-scroll",
  "快捷键": "keyboard",
  "快速终端": "quick-terminal",
  "隐私与安全": "privacy-security",
  "Shell 与环境": "shell-environment",
  "macOS": "macos",
  "Linux / GTK": "linux-gtk",
  "高级": "advanced",
  "需要检查": "unknown",
};

export function categoryId(category: string): string {
  return legacyCategoryIds[category] ?? category;
}

export function categoryLabel(locale: AppLocale, category: string): string {
  const id = categoryId(category);
  const labels: Record<string, [string, string]> = {
    appearance: ["外观", "Appearance"],
    font: ["字体", "Fonts"],
    window: ["窗口", "Window"],
    cursor: ["光标", "Cursor"],
    "mouse-scroll": ["鼠标与滚动", "Mouse & scrolling"],
    keyboard: ["快捷键", "Keyboard"],
    "quick-terminal": ["快速终端", "Quick Terminal"],
    "privacy-security": ["隐私与安全", "Privacy & security"],
    "shell-environment": ["Shell 与环境", "Shell & environment"],
    macos: ["macOS", "macOS"],
    "linux-gtk": ["Linux / GTK", "Linux / GTK"],
    advanced: ["高级", "Advanced"],
    unknown: ["需要检查", "Needs review"],
  };
  const label = labels[id];
  return label ? textForLocale(locale, label[0], label[1]) : category;
}

export const COMMON_SETTING_KEYS = [
  "theme",
  "background",
  "foreground",
  "background-opacity",
  "background-image",
  "background-image-opacity",
  "background-image-fit",
  "background-image-position",
  "background-image-repeat",
  "background-opacity-cells",
  "font-size",
  "cursor-style",
  "cursor-style-blink",
  "cursor-color",
  "unfocused-split-opacity",
  "mouse-hide-while-typing",
] as const;

export const PREVIEW_SETTING_KEYS = new Set([
  "background",
  "foreground",
  "background-opacity",
  "background-image",
  "background-image-opacity",
  "background-image-fit",
  "background-image-position",
  "background-image-repeat",
  "font-family",
  "font-size",
  "window-padding-x",
  "window-padding-y",
  "cursor-style",
  "cursor-color",
]);

export function chooseStartupCandidate(
  candidates: ConfigCandidate[],
  preferredId: string | null,
): ConfigCandidate | null {
  const existing = candidates.filter((candidate) => candidate.exists);
  if (preferredId) {
    const preferred = existing.find((candidate) => candidate.id === preferredId);
    if (preferred) return preferred;
  }
  const roots = existing.filter((candidate) => candidate.source !== "include");
  return roots.length === 1 ? roots[0] : null;
}

/**
 * Refreshing an open workspace must never jump to a different write target.
 * If the active source disappeared, the user must make the next choice; when
 * no workspace has been opened yet, the same conservative startup rules apply.
 */
export function chooseWorkspaceCandidate(
  candidates: ConfigCandidate[],
  activeId: string | null,
  preferredId: string | null,
): ConfigCandidate | null {
  const existing = candidates.filter((candidate) => candidate.exists);
  if (activeId) return existing.find((candidate) => candidate.id === activeId) ?? null;
  return chooseStartupCandidate(existing, preferredId);
}

export function isCommonSetting(option: RuntimeOption): boolean {
  return COMMON_SETTING_KEYS.includes(option.key as typeof COMMON_SETTING_KEYS[number])
    && isGenericallyEditable(option);
}

export function editableCategoryCounts(options: RuntimeOption[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const option of options) {
    if (!isGenericallyEditable(option)) continue;
    const id = categoryId(option.category);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export function configuredSettingMap(
  configured: ConfiguredSetting[],
): Map<string, ConfiguredSetting> {
  return new Map(configured.map((item) => [item.key, item]));
}

export function withConfiguredReferences(
  options: RuntimeOption[],
  configured: ConfiguredSetting[],
): RuntimeOption[] {
  const knownKeys = new Set(options.map((option) => option.key));
  const missing = configured
    .filter((item) => !knownKeys.has(item.key))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map<RuntimeOption>((item) => ({
      key: item.key,
      description: "",
      defaultValues: [],
      currentValues: [],
      category: "unknown",
      kind: "text",
      choices: [],
      repeatable: item.occurrenceCount > 1,
      platform: null,
      since: null,
      risk: "advanced",
      editable: false,
      capability: {
        editMode: "none",
        reason: "unrecognized-setting",
        activation: "unknown",
        constraintBehavior: "unknown",
        min: null,
        max: null,
        step: null,
        unit: null,
        platform: null,
      },
    }));
  return missing.length > 0 ? [...options, ...missing] : options;
}

export function restrictionLabel(option: RuntimeOption, locale: AppLocale = "zh-CN"): string {
  switch (option.capability.reason) {
    case "needs-list-editor":
      return textForLocale(locale, "在配置文件中调整", "Edit in config file");
    case "needs-theme-picker":
      return textForLocale(locale, "在配置文件中调整", "Edit in config file");
    case "protected":
      return textForLocale(locale, "敏感设置", "Sensitive setting");
    case "advanced-setting":
      return textForLocale(locale, "需要专用编辑器", "Needs a dedicated editor");
    case "platform-unavailable":
      return option.platform
        ? textForLocale(locale, `仅适用于 ${option.platform}`, `${option.platform} only`)
        : textForLocale(locale, "不适用于当前系统", "Unavailable on this system");
    case "version-not-supported":
      return textForLocale(locale, "当前版本只读", "Read only in this version");
    case "setting-changed":
      return textForLocale(locale, "设置已变化", "Changed in update");
    case "needs-editor":
      return textForLocale(locale, "在配置文件中调整", "Edit in config file");
    case "unrecognized-setting":
      return textForLocale(locale, "需要检查", "Needs review");
    default:
      return textForLocale(locale, "在配置文件中调整", "Edit in config file");
  }
}

export function restrictionDescription(option: RuntimeOption, locale: AppLocale = "zh-CN"): string {
  switch (option.capability.reason) {
    case "needs-list-editor":
      return textForLocale(locale, "包含多个有序值，请在配置文件中编辑。", "This is an ordered list. Edit it in the config file.");
    case "needs-theme-picker":
      return textForLocale(locale, "可分别设置浅色与深色主题，请在配置文件中编辑。", "Light and dark themes can be set separately. Edit them in the config file.");
    case "protected":
      return textForLocale(locale, "可能包含命令、路径或隐私信息，请在配置文件中编辑。", "This may contain commands, paths, or private data. Edit it in the config file.");
    case "advanced-setting":
    case "needs-editor":
      return textForLocale(locale, "需要专用编辑器，暂不支持。", "A dedicated editor is required and not yet available.");
    case "platform-unavailable":
      return option.platform
        ? textForLocale(locale, `这项设置仅适用于 ${option.platform}。`, `This setting is available only on ${option.platform}.`)
        : textForLocale(locale, "这项设置不适用于当前系统。", "This setting is not available on this system.");
    case "version-not-supported":
      return textForLocale(locale, "当前版本暂不支持编辑。", "Editing is unavailable for this version.");
    case "setting-changed":
      return textForLocale(locale, "该设置已在 Ghostty 更新中发生变化，暂不可编辑。", "This setting changed in a Ghostty update and is temporarily read-only.");
    case "unrecognized-setting":
      return textForLocale(locale, "Ghostty 当前无法识别这个配置名。它可能来自旧版本、扩展，也可能存在拼写错误。", "Ghostty does not recognize this key. It may come from an older version, an extension, or a typo.");
    default:
      return textForLocale(locale, "请在配置文件中编辑。", "Edit this in the config file.");
  }
}
