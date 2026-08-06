import { AlertTriangle, ArrowRight, Check, FileCode2, X } from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import { copyForSetting } from "../settingCopy";
import type { ChangePreview, DraftChange } from "../types";
import { localizedSettingChoice } from "../settingChoices";
import {
  assetIdFromBackgroundValue,
  EXTERNAL_BACKGROUND_TOKEN,
  RESET_BACKGROUND_TOKEN,
} from "../backgroundImageModel";
import { hasSourceBoundRemoval } from "../draftMigration";
import { useDialogFocus } from "./useDialogFocus";

interface ReviewPanelProps {
  changes: DraftChange[];
  preview: ChangePreview | null;
  loading: boolean;
  applying?: boolean;
  busy?: boolean;
  canRecover?: boolean;
  readOnly: boolean;
  targetLabel?: string;
  previewOnly?: boolean;
  backgroundAssetNames?: Record<string, string>;
  onClose(): void;
  onApply(): void;
  onRetry?(): void;
  onRecover?(): void;
  onUseSuggestedSource?(candidateId: string): void;
}

function readableValue(
  locale: AppLocale,
  key: string,
  values: string[],
  emptyLabel: string,
  backgroundAssetNames: Record<string, string>,
): string {
  const value = values.at(-1);
  if (value == null || value === "") return emptyLabel;
  if (key === "background-image") {
    if (value === RESET_BACKGROUND_TOKEN) {
      return locale === "zh-CN" ? "关闭背景图片" : "Turn off background image";
    }
    if (value === EXTERNAL_BACKGROUND_TOKEN) {
      return locale === "zh-CN" ? "外部图片（路径已隐藏）" : "External image (path hidden)";
    }
    const assetId = assetIdFromBackgroundValue(value);
    if (assetId) {
      return backgroundAssetNames[assetId]
        ?? (locale === "zh-CN" ? "图片库中的图片" : "Image from the library");
    }
    return locale === "zh-CN" ? "图片值已隐藏" : "Image value hidden";
  }
  if (value === "true" || value === "false") {
    return localizedSettingChoice(locale, key, value);
  }
  const localizedChoice = localizedSettingChoice(locale, key, value);
  if (localizedChoice !== value) return localizedChoice;
  if (key === "background-opacity" || key === "background-image-opacity") {
    const opacity = Number(value);
    if (Number.isFinite(opacity)) return `${Math.round(opacity * 100)}%`;
  }
  if (key === "font-size") return `${value} pt`;
  if (key.startsWith("window-padding")) return `${value} px`;
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
  return value;
}

function activationCopy(locale: AppLocale, activation: ChangePreview["activation"]): string {
  const chinese = locale === "zh-CN";
  if (activation === "restart") {
    return chinese ? "保存后需要重启 Ghostty。" : "Restart Ghostty after saving.";
  }
  if (activation === "reload-new-terminal") {
    return chinese
      ? "重新载入后，新终端会使用这些更改。"
      : "Reload Ghostty to use these changes in new terminals.";
  }
  if (activation === "reload") {
    return chinese ? "保存后重新载入 Ghostty。" : "Reload Ghostty after saving.";
  }
  return chinese
    ? "保存后请在 Ghostty 中确认效果。"
    : "Check the result in Ghostty after saving.";
}

function displayDiagnostic(locale: AppLocale, diagnostic: string): string {
  if (locale === "zh-CN") return diagnostic;
  if (diagnostic === "Ghostty 无法读取这份配置，但未提供具体原因。") {
    return "Ghostty could not read this configuration and did not provide a specific reason.";
  }
  const issues = diagnostic.match(/^Ghostty 无法读取这份配置（发现 (\d+) 条问题）/);
  if (issues) {
    const count = Number(issues[1]);
    return `Ghostty could not read this configuration (${count} ${count === 1 ? "issue" : "issues"}). Details are hidden to protect paths and values.`;
  }
  return "Ghostty returned a diagnostic that is not available in this language.";
}

export function ReviewPanel({
  changes,
  preview,
  loading,
  applying = false,
  busy = false,
  canRecover = false,
  readOnly,
  targetLabel,
  previewOnly = false,
  backgroundAssetNames = {},
  onClose,
  onApply,
  onRetry,
  onRecover,
  onUseSuggestedSource,
}: ReviewPanelProps) {
  const { locale, text } = useI18n();
  const interactionBlocked = applying || busy;
  const dialogRef = useDialogFocus(onClose, interactionBlocked);
  const reviewedChanges = preview?.changes ?? changes;
  const checkingFailed = !loading && !applying && !preview;
  const containsSourceBoundRemoval = hasSourceBoundRemoval(reviewedChanges);

  const closeUnlessApplying = () => {
    if (!interactionBlocked) onClose();
  };

  return (
    <div className="review-backdrop" role="presentation" onMouseDown={closeUnlessApplying}>
      <section
        ref={dialogRef}
        className="review-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-busy={loading || interactionBlocked}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <h2 id="review-title">
              {previewOnly ? text("查看这些更改", "Review changes") : text("保存这些更改？", "Save these changes?")}
            </h2>
            <p>
              {previewOnly
                ? text(
                    `${reviewedChanges.length} 项试用修改，不会写入文件。`,
                    `${reviewedChanges.length} preview ${reviewedChanges.length === 1 ? "change" : "changes"}. Nothing will be written to disk.`,
                  )
                : text(
                    `${reviewedChanges.length} 项修改将写入 ${targetLabel ?? "当前配置"}。`,
                    `${reviewedChanges.length} ${reviewedChanges.length === 1 ? "change" : "changes"} will be saved to ${targetLabel ?? "the current configuration"}.`,
                  )}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={text("关闭更改审阅", "Close change review")}
            disabled={interactionBlocked}
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label={text("更改审阅内容", "Change review details")}>
          {loading && !applying && (
            <div className="loading-card" role="status" aria-live="polite">
              {text("正在用 Ghostty 检查配置…", "Checking the configuration with Ghostty…")}
            </div>
          )}
          {applying && (
            <div className="loading-card" role="status" aria-live="polite">
              {text("正在创建恢复点并保存…", "Creating a restore point and saving…")}
            </div>
          )}
          {checkingFailed && (
            <div className="diagnostic" role="alert">
              <AlertTriangle size={15} />
              <span>
                {text(
                  "未能完成检查。草稿仍然保留，你可以重试或重新读取配置。",
                  "The check could not be completed. Your draft is still here; try again or reload the configuration.",
                )}
              </span>
            </div>
          )}
          {!loading && preview?.valid && (
            <div className="review-validation" role="status">
              <span><Check size={15} /></span>
              <div>
                <strong>
                  {previewOnly
                    ? text("更改已准备好", "Changes are ready")
                    : text("检查通过", "Checks passed")}
                </strong>
                {!previewOnly && (
                  <small>
                    {activationCopy(locale, preview.activation)} {text("保存前会创建恢复点。", "A restore point will be created first.")}
                  </small>
                )}
              </div>
            </div>
          )}

          {!loading && preview?.valid && preview.effect.status === "overridden" && (
            <div className="review-effect review-effect--warning" role="status">
              <AlertTriangle size={15} />
              <div>
                <strong>{text(
                  "当前保存位置会被后续配置覆盖",
                  "A later configuration source will override this save destination",
                )}</strong>
                <span>{containsSourceBoundRemoval
                  ? text(
                      "此草稿包含仅针对当前文件的删除操作。请打开 {source} 后重新修改。",
                      "This draft includes a removal tied to the current file. Open {source} and make the change there.",
                      { source: preview.effect.suggestedLabel ?? text("最终来源", "the effective source") },
                    )
                  : text(
                      "{count} 项修改不会进入 Ghostty 的最终配置。",
                      "{count} {noun} will not reach Ghostty's effective configuration.",
                      {
                        count: preview.effect.affectedKeys.length,
                        noun: preview.effect.affectedKeys.length === 1 ? "change" : "changes",
                      },
                    )}</span>
              </div>
            </div>
          )}

          {!loading && preview?.valid && preview.effect.status === "unverified" && (
            <div className="review-effect review-effect--warning" role="status">
              <AlertTriangle size={15} />
              <div>
                <strong>{text("无法确认最终生效来源", "The effective source could not be verified")}</strong>
                <span>{text(
                  "无法确认哪份配置最终生效，暂时不能保存。",
                  "The effective configuration could not be identified, so saving is unavailable.",
                )}</span>
              </div>
            </div>
          )}

          {!loading && (
            <div className="review-change-list">
              {reviewedChanges.map((change) => {
                const copy = copyForSetting(locale, change.key, "");
                return (
                  <article className="review-change" key={change.key}>
                    <div className="review-change__title">
                      <strong>{copy.label}</strong>
                      {copy.label !== change.key && <code>{change.key}</code>}
                    </div>
                    <div className="review-change__values">
                      <span>{readableValue(locale, change.key, change.before, text("未设置", "Not set"), backgroundAssetNames)}</span>
                      <ArrowRight size={14} />
                      <strong>
                        {readableValue(
                          locale,
                          change.key,
                          change.after,
                          text("从当前文件移除", "Remove from this file"),
                          backgroundAssetNames,
                        )}
                      </strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && preview?.diagnostics
            .filter((diagnostic) => !(preview.valid && diagnostic === "已通过当前 Ghostty 二进制验证。"))
            .map((diagnostic) => (
              <div className="diagnostic" role={preview.valid ? "status" : "alert"} key={diagnostic}>
                {preview.valid ? <Check size={15} /> : <AlertTriangle size={15} />}
                <span>{displayDiagnostic(locale, diagnostic)}</span>
              </div>
            ))}

          {!loading && preview?.unifiedDiff && (
            <details className="raw-diff">
              <summary><FileCode2 size={14} /> {text("查看配置文本变化", "View configuration diff")}</summary>
              <pre>{preview.unifiedDiff}</pre>
            </details>
          )}

        </div>

        <footer className="review-footer">
          {!previewOnly && readOnly && (
            <span className="readonly-note">
              {text("当前配置只能查看，无法保存。", "This configuration is read only and cannot be saved.")}
            </span>
          )}
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={interactionBlocked}
          >
            {previewOnly ? text("返回编辑", "Back to editing") : text("继续编辑", "Keep editing")}
          </button>
          {!loading && !applying && !preview?.valid && canRecover && onRecover && (
            <button type="button" className="button button--secondary" onClick={onRecover} disabled={interactionBlocked}>
              {text("重新读取并保留草稿", "Reload and keep draft")}
            </button>
          )}
          {!loading && !applying && !preview?.valid && (!canRecover || !onRecover) && onRetry && (
            <button type="button" className="button button--secondary" onClick={onRetry} disabled={interactionBlocked}>
              {text("重新检查", "Check again")}
            </button>
          )}
          {!previewOnly && (
            preview?.effect.status === "overridden"
              && preview.effect.suggestedCandidateId
              && onUseSuggestedSource
              && !containsSourceBoundRemoval
          ) && (
            <button
              type="button"
              className="button button--primary"
              disabled={loading || interactionBlocked}
              onClick={() => onUseSuggestedSource(preview.effect.suggestedCandidateId!)}
            >
              {text(
                "改存到 {source}",
                "Save to {source}",
                { source: preview.effect.suggestedLabel ?? text("生效来源", "effective source") },
              )}
            </button>
          )}
          {!previewOnly && (
            <button
              type="button"
              className="button button--primary"
              disabled={readOnly || loading || interactionBlocked || !preview?.valid || preview.effect.status !== "effective"}
              onClick={onApply}
            >
              {applying ? text("正在保存…", "Saving…") : text("保存", "Save")}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
