import type { RuntimeOption } from "../types";

interface SettingControlProps {
  option: RuntimeOption;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

function normalizeColor(value: string): string {
  const stripped = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(stripped) ? `#${stripped}` : "#000000";
}

export function SettingControl({ option, value, disabled = false, onChange }: SettingControlProps) {
  if (option.kind === "boolean") {
    const enabled = value === "true";
    return (
      <button
        type="button"
        className={`switch ${enabled ? "switch--on" : ""}`}
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        aria-label={`${option.key}: ${enabled ? "开启" : "关闭"}`}
        onClick={() => onChange(enabled ? "false" : "true")}
      >
        <span />
      </button>
    );
  }

  if (option.kind === "select" && option.choices.length > 0) {
    return (
      <select
        disabled={disabled}
        value={value}
        aria-label={`${option.key} 选项`}
        onChange={(event) => onChange(event.target.value)}
      >
        {!option.choices.includes(value) && <option value={value}>{value}</option>}
        {option.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  if (option.kind === "color") {
    return (
      <div className="color-control">
        <input
          type="color"
          disabled={disabled}
          value={normalizeColor(value)}
          onChange={(event) => onChange(event.target.value.slice(1))}
          aria-label={`${option.key} 颜色`}
        />
        <input
          className="color-value"
          disabled={disabled}
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.replace(/^#/, ""))}
          aria-label={`${option.key} 色值`}
        />
      </div>
    );
  }

  if (option.kind === "number" || option.kind === "integer") {
    const numeric = Number(value);
    const opacity = option.key.includes("opacity");
    return (
      <div className="number-control">
        {opacity && (
          <input
            type="range"
            disabled={disabled}
            min="0"
            max="1"
            step="0.01"
            value={Number.isFinite(numeric) ? numeric : 1}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`${option.key} 滑块`}
          />
        )}
        <input
          type="number"
          disabled={disabled}
          min={opacity ? "0" : undefined}
          max={opacity ? "1" : undefined}
          step={option.kind === "integer" ? "1" : opacity ? "0.01" : "0.5"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${option.key} 数值`}
        />
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
      aria-label={`${option.key} 值`}
    />
  );
}
