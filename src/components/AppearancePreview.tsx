import { memo, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import { TerminalPreview } from "./TerminalPreview";

export type PreviewMode = "saved" | "draft";

interface PreviewImage {
  dataUrl: string;
  name?: string;
}

interface PreviewModeControlProps {
  mode: PreviewMode;
  effectiveKnown: boolean;
  onChange(mode: PreviewMode): void;
}

const previewModes: PreviewMode[] = ["saved", "draft"];

function movePreviewMode(
  event: KeyboardEvent<HTMLButtonElement>,
  currentMode: PreviewMode,
  onChange: (mode: PreviewMode) => void,
) {
  const currentIndex = previewModes.indexOf(currentMode);
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % previewModes.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + previewModes.length) % previewModes.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = previewModes.length - 1;
  }
  if (nextIndex === null) return;
  event.preventDefault();
  const nextMode = previewModes[nextIndex];
  onChange(nextMode);
  event.currentTarget
    .closest<HTMLElement>("[role='radiogroup']")
    ?.querySelectorAll<HTMLButtonElement>("button[role='radio']")[nextIndex]
    ?.focus();
}

export function PreviewModeControl({
  mode,
  effectiveKnown,
  onChange,
}: PreviewModeControlProps) {
  const { text } = useI18n();
  return (
    <div className="preview-segment" role="radiogroup" aria-label={text("预览版本", "Preview version")}>
      {previewModes.map((candidate) => {
        const selected = mode === candidate;
        const label = candidate === "saved"
          ? effectiveKnown
            ? text("最终配置", "Effective")
            : text("当前文件", "This file")
          : text("修改后", "Draft");
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "active" : ""}
            onClick={() => onChange(candidate)}
            onKeyDown={(event) => movePreviewMode(event, candidate, onChange)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface AppearancePreviewProps {
  mode: PreviewMode;
  effectiveKnown: boolean;
  savedValues: Record<string, string>;
  draftValues: Record<string, string>;
  savedBackgroundImage?: PreviewImage | null;
  draftBackgroundImage?: PreviewImage | null;
  ignoredChangeCount: number;
  variant?: "pane" | "inline";
  onModeChange(mode: PreviewMode): void;
}

export const AppearancePreview = memo(function AppearancePreview({
  mode,
  effectiveKnown,
  savedValues,
  draftValues,
  savedBackgroundImage,
  draftBackgroundImage,
  ignoredChangeCount,
  variant = "pane",
  onModeChange,
}: AppearancePreviewProps) {
  const { text } = useI18n();
  return (
    <div className={`appearance-preview appearance-preview--${variant}`}>
      <div className="preview-heading">
        <div><strong>{text("外观预览", "Appearance preview")}</strong></div>
        <PreviewModeControl
          mode={mode}
          effectiveKnown={effectiveKnown}
          onChange={onModeChange}
        />
      </div>
      <TerminalPreview
        values={mode === "draft" ? draftValues : savedValues}
        backgroundImage={mode === "draft" ? draftBackgroundImage : savedBackgroundImage}
      />
      <p className="preview-note">{ignoredChangeCount > 0
        ? text(
            "{count} 项修改未显示，因为会被其他配置覆盖。",
            "{count} {noun} not shown because another configuration overrides them.",
            {
              count: ignoredChangeCount,
              noun: ignoredChangeCount === 1 ? "change is" : "changes are",
            },
          )
        : text("仅供预览，最终效果以 Ghostty 为准。", "Preview only. Final appearance may vary in Ghostty.")}</p>
    </div>
  );
});
