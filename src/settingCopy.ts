const summaries: Record<string, string> = {
  theme: "选择 Ghostty 主题，也可以分别设置浅色与深色主题。",
  background: "终端背景色。",
  foreground: "终端默认文字颜色。",
  "selection-foreground": "选中文字的前景色；留空时由 Ghostty 自动选择。",
  "selection-background": "选中文字的背景色；留空时由 Ghostty 自动选择。",
  "cursor-color": "光标颜色；留空时由 Ghostty 自动选择。",
  "split-divider-color": "分屏分隔线颜色；留空时由 Ghostty 自动选择。",
  "font-family": "终端字体，可以配置多个备用字体。",
  "font-size": "终端字号，单位为磅（pt），支持小数。",
  "minimum-contrast": "文字与背景的最低对比度，范围为 1–21；数值越高越易读。",
  "background-opacity": "控制背景可见程度；0% 完全透明，100% 完全不透明。",
  "background-opacity-cells": "让带背景色的终端单元格也跟随窗口透明度。",
  "background-blur": "为透明背景添加模糊效果。",
  "background-blur-radius": "为透明背景添加模糊，数值越大越柔和。",
  "cursor-opacity": "控制光标可见程度；0% 完全透明，100% 完全不透明。",
  "unfocused-split-opacity": "未聚焦分屏的不透明度；设为 100% 可关闭淡化效果。",
  "cursor-style": "默认光标形状；应用或 Shell 可以临时覆盖。",
  "cursor-style-blink": "让光标闪烁。",
  "window-padding-x": "窗口左右留白。",
  "window-padding-y": "窗口上下留白。",
  "bell-audio-path": "终端响铃时播放的音频文件。",
  "clipboard-read": "终端程序读取剪贴板时的处理方式。",
  "clipboard-write": "终端程序写入剪贴板时的处理方式。",
};

const labels: Record<string, string> = {
  theme: "主题",
  background: "背景色",
  foreground: "文字颜色",
  "selection-foreground": "选区文字颜色",
  "selection-background": "选区背景颜色",
  "cursor-color": "光标颜色",
  "split-divider-color": "分屏线颜色",
  "font-family": "字体",
  "font-size": "字号",
  "minimum-contrast": "最低对比度",
  "background-opacity": "背景不透明度",
  "background-opacity-cells": "单元格背景透明度",
  "background-blur": "背景模糊",
  "background-blur-radius": "背景模糊",
  "cursor-opacity": "光标不透明度",
  "unfocused-split-opacity": "未聚焦分屏透明度",
  "cursor-style": "光标形状",
  "cursor-style-blink": "光标闪烁",
  "window-padding-x": "水平窗口留白",
  "window-padding-y": "垂直窗口留白",
  "bell-audio-path": "响铃音频",
  "clipboard-read": "剪贴板读取",
  "clipboard-write": "剪贴板写入",
};

export interface SettingCopy {
  label: string;
  summary: string | null;
  detail: string | null;
}

function shortenOfficialDescription(description: string): string {
  const sentenceEnd = description.search(/[.!?](?:\s|$)/);
  const firstSentence = sentenceEnd >= 0
    ? description.slice(0, sentenceEnd + 1)
    : description;
  if (firstSentence.length <= 180) return firstSentence;

  const shortened = firstSentence.slice(0, 180);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 120 ? lastSpace : 180).trimEnd()}…`;
}

export function copyForSetting(key: string, description: string): SettingCopy {
  const official = description.replace(/\s+/g, " ").trim();
  const localized = summaries[key];
  const label = labels[key] ?? key;
  if (localized) {
    const localizedOfficial = /[\u3400-\u9fff]/.test(official);
    return { label, summary: localized, detail: official && !localizedOfficial ? official : null };
  }
  if (!official) return { label, summary: null, detail: null };

  const summary = shortenOfficialDescription(official);
  return {
    label,
    summary,
    detail: summary === official ? null : official,
  };
}
