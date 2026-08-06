import { memo } from "react";
import { ChevronRight, CircleMinus, RotateCcw } from "lucide-react";
import { useI18n } from "../i18n";
import { copyForSetting } from "../settingCopy";
import type { RuntimeOption } from "../types";
import { localizedSettingChoice } from "../settingChoices";
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
  const { locale, text } = useI18n();
  const modified = value !== baselineValue;
  const copy = copyForSetting(locale, option.key, option.description);
  const descriptionId = `setting-${option.key}-description`;
  const defaultValue = option.defaultValues.length > 0
    ? option.defaultValues
      .map((item) => item === ""
        ? text("未设置", "Not set")
        : localizedSettingChoice(locale, option.key, item))
      .join(", ")
    : text("未设置", "Not set");

  return (
    <article id={`setting-${option.key}`} className={`setting-row ${modified ? "setting-row--modified" : ""}`}>
      <div className="setting-copy">
        <div className="setting-title">
          <strong className="setting-label">{copy.label}</strong>
          {modified && <span className="modified-dot" aria-label={text("已修改", "Modified")} />}
        </div>
        {copy.summary && <p className="setting-summary" id={descriptionId}>{copy.summary}</p>}
      </div>
      <div className="setting-input">
        <SettingControl
          option={option}
          value={value}
          label={copy.label}
          describedBy={copy.summary ? descriptionId : undefined}
          onChange={(nextValue) => onValueChange(option.key, nextValue)}
        />
        <button
          type="button"
          className={`inline-reset ${modified ? "" : "inline-reset--placeholder"}`}
          disabled={!modified}
          tabIndex={modified ? 0 : -1}
          aria-hidden={!modified}
          onClick={() => onReset(option.key, baselineValue)}
          aria-label={text(`撤销${copy.label}的修改`, `Undo changes to ${copy.label}`)}
          title={text("撤销这项修改", "Undo this change")}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <details className="setting-inspector">
        <summary aria-label={text(`查看${copy.label}说明`, `About ${copy.label}`)}>
          <ChevronRight size={13} /> {text("详情", "Details")}
        </summary>
        <div className="setting-inspector__body">
          <dl>
            <div><dt>{text("配置名", "Configuration key")}</dt><dd><code>{option.key}</code></dd></div>
            <div><dt>{text("默认值", "Default")}</dt><dd>{defaultValue}</dd></div>
            <div>
              <dt>{text("这份文件", "This file")}</dt>
              <dd>{configuredInEditingLayer ? sourceLabel : text("未设置", "Not set")}</dd>
            </div>
          </dl>
          {copy.detail && (
            <details className="setting-official-detail">
              <summary>{text("Ghostty 原文", "Ghostty documentation")}</summary>
              <p>{copy.detail}</p>
            </details>
          )}
          {configuredInEditingLayer && (
            <button
              type="button"
              className="setting-unset"
              disabled={value === ""}
              onClick={() => onValueChange(option.key, "")}
            >
              <CircleMinus size={13} />
              {value === ""
                ? text("保存时移除", "Will be removed when saved")
                : text("从这份文件移除", "Remove from this file")}
            </button>
          )}
        </div>
      </details>
    </article>
  );
});
