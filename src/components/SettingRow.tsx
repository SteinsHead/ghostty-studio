import { memo } from "react";
import { CircleMinus, Info, LockKeyhole, RotateCcw } from "lucide-react";
import { copyForSetting } from "../settingCopy";
import type { RuntimeOption } from "../types";
import { SettingControl } from "./SettingControl";

interface SettingRowProps {
  option: RuntimeOption;
  value: string;
  baselineValue: string;
  configuredInEditingLayer: boolean;
  effectiveValueKnown: boolean;
  sourceLabel: string;
  onValueChange(key: string, value: string): void;
  onReset(key: string, baselineValue: string): void;
}

export const SettingRow = memo(function SettingRow({
  option,
  value,
  baselineValue,
  configuredInEditingLayer,
  effectiveValueKnown,
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
  const descriptionId = `setting-${option.key}-description`;
  const restrictionId = `setting-${option.key}-restriction`;

  return (
    <article className={`setting-row ${modified ? "setting-row--modified" : ""}`}>
      <div className="setting-copy">
        <div className="setting-title">
          <strong className="setting-label">{copy.label}</strong>
          {modified && <span className="modified-dot" aria-label="已修改" />}
          {restrictionLabel && (
            <span className="setting-restriction" id={restrictionId}>
              <LockKeyhole size={12} />{restrictionLabel}
            </span>
          )}
        </div>
        {copy.summary && <p className="setting-summary" id={descriptionId}>{copy.summary}</p>}
        <details className="setting-inspector">
          <summary><Info size={12} /> 详细信息</summary>
          <div className="setting-inspector__body">
            <dl>
              <div><dt>Ghostty 配置名</dt><dd><code>{option.key}</code></dd></div>
              <div><dt>默认值</dt><dd>{option.defaultValues.join(", ") || "未设置"}</dd></div>
              <div><dt>当前文件</dt><dd>{configuredInEditingLayer ? sourceLabel : "未显式设置"}</dd></div>
            </dl>
            {!effectiveValueKnown && <p>其他配置来源可能覆盖这里的值。</p>}
            {copy.detail && <p>{copy.detail}</p>}
            {configuredInEditingLayer && !requiresSpecialEditor && (
              <button
                type="button"
                className="setting-unset"
                disabled={value === ""}
                onClick={() => onValueChange(option.key, "")}
              >
                <CircleMinus size={13} />
                {value === "" ? "保存时从当前文件移除" : "从当前文件移除"}
              </button>
            )}
          </div>
        </details>
      </div>
      <div className="setting-input">
        <SettingControl
          option={option}
          value={value}
          label={copy.label}
          disabled={requiresSpecialEditor}
          describedBy={`${copy.summary ? descriptionId : ""} ${restrictionLabel ? restrictionId : ""}`.trim()}
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
