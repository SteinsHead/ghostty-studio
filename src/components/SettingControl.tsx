import type { CSSProperties } from "react";
import type { RuntimeOption } from "../types";
import { useI18n } from "../i18n";
import { localizedSettingChoice } from "../settingChoices";

interface SettingControlProps {
  option: RuntimeOption;
  value: string;
  label?: string;
  disabled?: boolean;
  describedBy?: string;
  onChange(value: string): void;
}

function normalizeColor(value: string): string {
  const stripped = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(stripped) ? `#${stripped}` : "#000000";
}

export function SettingControl({
  option,
  value,
  label = option.key,
  disabled = false,
  describedBy,
  onChange,
}: SettingControlProps) {
  const { locale, text } = useI18n();

  if (option.kind === "boolean") {
    const enabled = value === "true";
    return (
      <button
        type="button"
        className={`switch ${enabled ? "switch--on" : ""}`}
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-label={text(
          `${label}：${enabled ? "开启" : "关闭"}`,
          `${label}: ${enabled ? "On" : "Off"}`,
        )}
        onClick={() => onChange(enabled ? "false" : "true")}
      >
        <span />
      </button>
    );
  }

  if (option.kind === "select" && option.choices.length > 0) {
    const choiceLabel = (choice: string) => {
      if (option.key === "cursor-style-blink") {
        if (choice === "") return text("跟随终端", "Follow terminal");
        if (choice === "true") return text("始终闪烁", "Always blink");
        if (choice === "false") return text("不闪烁", "Never blink");
      }
      return localizedSettingChoice(locale, option.key, choice) || text("默认", "Default");
    };
    return (
      <select
        disabled={disabled}
        value={value}
        aria-label={text(`${label} 选项`, `${label} options`)}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        {!option.choices.includes(value) && <option value={value}>{value}</option>}
        {option.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choiceLabel(choice)}
          </option>
        ))}
      </select>
    );
  }

  if (option.kind === "color") {
    const colorValid = /^[0-9a-fA-F]{6}$/.test(value.trim().replace(/^#/, ""));
    const errorId = `setting-${option.key}-color-error`;
    const colorDescription = [describedBy, colorValid ? null : errorId].filter(Boolean).join(" ") || undefined;
    return (
      <div
        className={`color-control ${colorValid ? "" : "color-control--invalid"}`}
        title={colorValid ? undefined : text("请输入 6 位十六进制色值", "Enter a six-digit hexadecimal color")}
      >
        <input
          type="color"
          disabled={disabled}
          value={normalizeColor(value)}
          onChange={(event) => onChange(event.target.value.slice(1))}
          aria-label={text(`${label} 取色器`, `${label} picker`)}
          aria-describedby={colorDescription}
        />
        <div className="color-value-field">
          <span aria-hidden="true">#</span>
          <input
            className="color-value"
            disabled={disabled}
            value={value}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value.replace(/^#/, ""))}
            aria-label={text(`${label} 色值`, `${label} value`)}
            aria-describedby={colorDescription}
            aria-invalid={!colorValid}
          />
        </div>
        {!colorValid && <span id={errorId} className="sr-only">{text("请输入 6 位十六进制色值", "Enter a six-digit hexadecimal color")}</span>}
      </div>
    );
  }

  if (option.kind === "number" || option.kind === "integer") {
    const numeric = Number(value);
    const percentage = option.capability.unit === "percent" || option.key.includes("opacity");
    const min = option.capability.min ?? undefined;
    const max = option.capability.max ?? undefined;
    const step = option.capability.step ?? (option.kind === "integer" ? 1 : 0.5);
    const hasRange = percentage && min != null && max != null;
    const rangeMin = min ?? 0;
    const rangeMax = max ?? 0;
    const rangeValue = hasRange
      ? (Number.isFinite(numeric) ? Math.min(rangeMax, Math.max(rangeMin, numeric)) : rangeMax)
      : null;
    const rangeProgress = hasRange && rangeMax > rangeMin
      ? ((rangeValue! - rangeMin) / (rangeMax - rangeMin)) * 100
      : 0;
    return (
      <div className={`number-control ${hasRange ? "number-control--slider" : "number-control--compact"}`}>
        {hasRange && (
          <input
            type="range"
            disabled={disabled}
            min={rangeMin}
            max={rangeMax}
            step={step}
            value={rangeValue!}
            style={{ "--range-progress": `${rangeProgress}%` } as CSSProperties}
            onChange={(event) => onChange(event.target.value)}
            aria-label={text(`${label} 滑块`, `${label} slider`)}
            aria-valuetext={`${Math.round(rangeValue! * 100)}%`}
            aria-describedby={describedBy}
          />
        )}
        {percentage ? (
          <div className="percentage-control">
            <input
              type="number"
              disabled={disabled}
              min={min == null ? undefined : min * 100}
              max={max == null ? undefined : max * 100}
              step={step * 100}
              value={Number.isFinite(numeric) ? Math.round(numeric * 100) : ""}
              onChange={(event) => {
                if (event.target.value === "") {
                  onChange("");
                  return;
                }
                const entered = Number(event.target.value) / 100;
                if (!Number.isFinite(entered)) return;
                const bounded = Math.min(max ?? entered, Math.max(min ?? entered, entered));
                onChange(String(bounded));
              }}
              aria-label={text(`${label} 百分比`, `${label} percentage`)}
              aria-describedby={describedBy}
            />
            <span aria-hidden="true">%</span>
          </div>
        ) : option.capability.unit === "pt" ? (
          <div className="number-value-field">
            <input
              type="number"
              disabled={disabled}
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              aria-label={text(`${label} 数值`, `${label} value`)}
              aria-describedby={describedBy}
            />
            <span aria-hidden="true">pt</span>
          </div>
        ) : (
          <input
            type="number"
            disabled={disabled}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={text(`${label} 数值`, `${label} value`)}
            aria-describedby={describedBy}
          />
        )}
      </div>
    );
  }

  return (
    <input
      className="text-control"
      disabled={disabled}
      value={value}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      aria-label={text(`${label} 值`, `${label} value`)}
      aria-describedby={describedBy}
    />
  );
}
