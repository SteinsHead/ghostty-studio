import { Globe2, RefreshCw } from "lucide-react";
import type { LanguagePreference, LocalizedText } from "../i18n";
import type { WorkspaceState } from "../productModel";

interface StudioToolbarProps {
  activeLabel?: string;
  fallbackTitle: string;
  readOnly: boolean;
  preference: LanguagePreference;
  refreshing: boolean;
  busy: boolean;
  reloadLabel: string;
  connectionLabel: string;
  connectionState: WorkspaceState;
  text: LocalizedText;
  onPreferenceChange(preference: LanguagePreference): void;
  onRefresh(): void;
}

export function StudioToolbar({
  activeLabel,
  fallbackTitle,
  readOnly,
  preference,
  refreshing,
  busy,
  reloadLabel,
  connectionLabel,
  connectionState,
  text,
  onPreferenceChange,
  onRefresh,
}: StudioToolbarProps) {
  return (
    <header className="studio-toolbar">
      <div className="studio-toolbar__title">
        <strong>{activeLabel ?? fallbackTitle}</strong>
        {activeLabel && (
          <span>{readOnly
            ? text("只读配置", "Read-only configuration")
            : text("当前写入位置", "Current write location")}</span>
        )}
      </div>
      <div className="studio-toolbar__actions">
        <label className="language-picker">
          <Globe2 size={14} aria-hidden="true" />
          <span className="sr-only">{text("界面语言", "Interface language")}</span>
          <select
            value={preference}
            aria-label={text("界面语言", "Interface language")}
            onChange={(event) => onPreferenceChange(event.target.value as LanguagePreference)}
          >
            <option value="system">{text("跟随系统", "System")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <button
          type="button"
          className="toolbar-icon"
          aria-label={reloadLabel}
          aria-busy={refreshing}
          title={reloadLabel}
          onClick={onRefresh}
          disabled={refreshing || busy}
        >
          <RefreshCw size={15} className={refreshing ? "spin" : ""} />
        </button>
        <span
          className={`connection-state connection-state--${connectionState}`}
          role="status"
          aria-label={connectionLabel}
          title={connectionLabel}
        >
          <i /><span aria-hidden="true">{connectionLabel}</span>
        </span>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {refreshing ? reloadLabel : ""}
        </span>
      </div>
    </header>
  );
}
