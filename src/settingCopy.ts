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
  "background-opacity": "背景不透明度：0 为完全透明，1 为完全不透明。",
  "background-opacity-cells": "让带背景色的终端单元格也跟随窗口透明度。",
  "background-blur": "为透明背景添加模糊效果。",
  "cursor-opacity": "光标不透明度：0 为完全透明，1 为完全不透明。",
  "unfocused-split-opacity": "未聚焦分屏的不透明度；设为 1 可关闭淡化效果。",
  "cursor-style": "默认光标形状；应用或 Shell 可以临时覆盖。",
  "cursor-style-blink": "让光标闪烁。",
  "window-padding-x": "窗口左右留白。",
  "window-padding-y": "窗口上下留白。",
  "bell-audio-path": "终端响铃时播放的音频文件。",
  "clipboard-read": "终端程序读取剪贴板时的处理方式。",
  "clipboard-write": "终端程序写入剪贴板时的处理方式。",
};

export interface SettingCopy {
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
  if (localized) {
    const localizedOfficial = /[\u3400-\u9fff]/.test(official);
    return { summary: localized, detail: official && !localizedOfficial ? official : null };
  }
  if (!official) return { summary: null, detail: null };

  const summary = shortenOfficialDescription(official);
  return {
    summary,
    detail: summary === official ? null : official,
  };
}
