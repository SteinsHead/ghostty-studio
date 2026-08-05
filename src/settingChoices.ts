import type { AppLocale } from "./i18n";

const localizedChoices: Record<string, Record<string, Record<AppLocale, string>>> = {
  "cursor-style": {
    block: { "zh-CN": "方块", en: "Block" },
    bar: { "zh-CN": "竖线", en: "Bar" },
    underline: { "zh-CN": "下划线", en: "Underline" },
    block_hollow: { "zh-CN": "空心方块", en: "Hollow block" },
  },
  "background-image-position": {
    "top-left": { "zh-CN": "左上", en: "Top left" },
    "top-center": { "zh-CN": "顶部居中", en: "Top center" },
    "top-right": { "zh-CN": "右上", en: "Top right" },
    "center-left": { "zh-CN": "左侧居中", en: "Center left" },
    center: { "zh-CN": "居中", en: "Center" },
    "center-right": { "zh-CN": "右侧居中", en: "Center right" },
    "bottom-left": { "zh-CN": "左下", en: "Bottom left" },
    "bottom-center": { "zh-CN": "底部居中", en: "Bottom center" },
    "bottom-right": { "zh-CN": "右下", en: "Bottom right" },
  },
  "background-image-fit": {
    contain: { "zh-CN": "完整显示", en: "Fit inside" },
    cover: { "zh-CN": "铺满并裁切", en: "Fill and crop" },
    stretch: { "zh-CN": "拉伸铺满", en: "Stretch to fill" },
    none: { "zh-CN": "原始尺寸", en: "Original size" },
  },
};

export function localizedSettingChoice(
  locale: AppLocale,
  key: string,
  choice: string,
): string {
  if (choice === "true") return locale === "zh-CN" ? "开启" : "On";
  if (choice === "false") return locale === "zh-CN" ? "关闭" : "Off";
  return localizedChoices[key]?.[choice]?.[locale] ?? choice;
}
