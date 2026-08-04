import { memo } from "react";
import { RotateCcw } from "lucide-react";
import { copyForSetting } from "../settingCopy";
import type { RuntimeOption } from "../types";
import { SettingControl } from "./SettingControl";

interface SettingRowProps {
  option: RuntimeOption;
  value: string;
  baselineValue: string;
  configuredInEditingLayer: boolean;
  sourceLabel: string;
  onValueChange(key: string, value: string): void;
  onReset(key: string, baselineValue: string): void;
}

export const SettingRow = memo(function SettingRow({
  option,
  value,
  baselineValue,
  configuredInEditingLayer,
  sourceLabel,
  onValueChange,
  onReset,
}: SettingRowProps) {
  const modified = value !== baselineValue;
  const requiresSpecialEditor = option.editable === false
    || option.repeatable
    || option.risk !== "normal";
  const restrictionLabel = option.risk === "sensitive"
    ? "敏感设置"
    : option.repeatable
      ? "多值设置"
      : requiresSpecialEditor
        ? "暂不支持编辑"
        : null;
  const copy = copyForSetting(option.key, option.description);

  return (
    <article className={`setting-row ${modified ? "setting-row--modified" : ""}`}>
      <div className="setting-copy">
        <div className="setting-title">
          <code>{option.key}</code>
          {modified && <span className="modified-dot">已修改</span>}
          {restrictionLabel && (
            <span className={option.risk === "sensitive" ? "risk-badge" : "policy-badge"}>
              {restrictionLabel}
            </span>
          )}
        </div>
        {copy.summary && <p className="setting-summary">{copy.summary}</p>}
        {copy.detail && (
          <details className="setting-details">
            <summary>Ghostty 原文</summary>
            <p>{copy.detail}</p>
          </details>
        )}
        <div className="setting-meta">
          <span>默认：{option.defaultValues.join(", ") || "未设置"}</span>
          <span>{configuredInEditingLayer ? `当前文件：${sourceLabel}` : "当前文件：未设置"}</span>
        </div>
      </div>
      <div className="setting-input">
        <SettingControl
          option={option}
          value={value}
          disabled={requiresSpecialEditor}
          onChange={(nextValue) => onValueChange(option.key, nextValue)}
        />
        <button
          type="button"
          className={`inline-reset ${modified ? "" : "inline-reset--placeholder"}`}
          disabled={!modified}
          tabIndex={modified ? 0 : -1}
          aria-hidden={!modified}
          onClick={() => onReset(option.key, baselineValue)}
          aria-label={`撤销 ${option.key} 的修改`}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </article>
  );
});
