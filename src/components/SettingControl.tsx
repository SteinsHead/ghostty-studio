import type { RuntimeOption } from "../types";

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
        aria-label={`${label}: ${enabled ? "开启" : "关闭"}`}
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
        aria-label={`${label} 选项`}
        aria-describedby={describedBy}
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
          aria-label={`${label} 颜色`}
          aria-describedby={describedBy}
        />
        <input
          className="color-value"
          disabled={disabled}
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.replace(/^#/, ""))}
          aria-label={`${label} 色值`}
          aria-describedby={describedBy}
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
            aria-label={`${label} 滑块`}
            aria-describedby={describedBy}
          />
        )}
        {opacity ? (
          <div className="percentage-control">
            <input
              type="number"
              disabled={disabled}
              min="0"
              max="100"
              step="1"
              value={Number.isFinite(numeric) ? Math.round(numeric * 100) : ""}
              onChange={(event) => {
                if (event.target.value === "") {
                  onChange("");
                  return;
                }
                const percentage = Math.min(100, Math.max(0, Number(event.target.value)));
                onChange(String(percentage / 100));
              }}
              aria-label={`${label} 百分比`}
              aria-describedby={describedBy}
            />
            <span aria-hidden="true">%</span>
          </div>
        ) : (
          <input
            type="number"
            disabled={disabled}
            step={option.kind === "integer" ? "1" : "0.5"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`${label} 数值`}
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
      aria-label={`${label} 值`}
      aria-describedby={describedBy}
    />
  );
}
