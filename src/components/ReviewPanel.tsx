import { AlertTriangle, ArrowRight, Check, FileCode2, X } from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import { copyForSetting } from "../settingCopy";
import type { ChangePreview, DraftChange } from "../types";
import { localizedSettingChoice } from "../settingChoices";
import { useDialogFocus } from "./useDialogFocus";

interface ReviewPanelProps {
  changes: DraftChange[];
  preview: ChangePreview | null;
  loading: boolean;
  applying?: boolean;
  canRecover?: boolean;
  readOnly: boolean;
  targetLabel?: string;
  previewOnly?: boolean;
  onClose(): void;
  onApply(): void;
  onRetry?(): void;
  onRecover?(): void;
}

function readableValue(
  locale: AppLocale,
  key: string,
  values: string[],
  emptyLabel: string,
): string {
  const value = values.at(-1);
  if (value == null || value === "") return emptyLabel;
  if (value === "true" || value === "false") {
    return localizedSettingChoice(locale, key, value);
  }
  const localizedChoice = localizedSettingChoice(locale, key, value);
  if (localizedChoice !== value) return localizedChoice;
  if (key === "background-opacity") {
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
  if (diagnostic === "已通过当前 Ghostty 二进制验证。") {
    return "Validated with the installed version of Ghostty.";
  }
  if (diagnostic === "Ghostty 拒绝了候选配置，但没有返回可解析的诊断。") {
    return "Ghostty rejected this configuration without a readable diagnostic.";
  }
  const rejected = diagnostic.match(/^Ghostty 拒绝了候选配置（返回 (\d+) 条诊断）/);
  if (rejected) {
    const count = Number(rejected[1]);
    return `Ghostty rejected this configuration. ${count} ${count === 1 ? "diagnostic was" : "diagnostics were"} hidden because they may contain paths or values.`;
  }
  return "Ghostty returned a diagnostic that is not available in this language.";
}

export function ReviewPanel({
  changes,
  preview,
  loading,
  applying = false,
  canRecover = false,
  readOnly,
  targetLabel,
  previewOnly = false,
  onClose,
  onApply,
  onRetry,
  onRecover,
}: ReviewPanelProps) {
  const { locale, text } = useI18n();
  const dialogRef = useDialogFocus(onClose, applying);
  const reviewedChanges = preview?.changes ?? changes;
  const checkingFailed = !loading && !applying && !preview;

  const closeUnlessApplying = () => {
    if (!applying) onClose();
  };

  return (
    <div className="review-backdrop" role="presentation" onMouseDown={closeUnlessApplying}>
      <section
        ref={dialogRef}
        className="review-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-describedby={previewOnly ? undefined : "review-safety-summary"}
        aria-busy={loading || applying}
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
            disabled={applying}
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
                    : text("Ghostty 可以读取这份配置", "Ghostty can read this configuration")}
                </strong>
                {!previewOnly && (
                  <small>
                    {activationCopy(locale, preview.activation)} {text("保存前会创建恢复点。", "A restore point will be created first.")}
                  </small>
                )}
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
                      <span>{readableValue(locale, change.key, change.before, text("未设置", "Not set"))}</span>
                      <ArrowRight size={14} />
                      <strong>
                        {readableValue(
                          locale,
                          change.key,
                          change.after,
                          text("从当前文件移除", "Remove from this file"),
                        )}
                      </strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && preview?.diagnostics.map((diagnostic) => (
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

          {!previewOnly && (
            <p className="review-safety-copy" id="review-safety-summary">
              {text(
                "保存前会再次确认文件没有被其他应用修改。",
                "Before saving, Studio will confirm that no other app has changed the file.",
              )}
            </p>
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
            disabled={applying}
          >
            {previewOnly ? text("返回编辑", "Back to editing") : text("继续编辑", "Keep editing")}
          </button>
          {!loading && !applying && !preview?.valid && canRecover && onRecover && (
            <button type="button" className="button button--secondary" onClick={onRecover}>
              {text("重新读取并保留草稿", "Reload and keep draft")}
            </button>
          )}
          {!loading && !applying && !preview?.valid && (!canRecover || !onRecover) && onRetry && (
            <button type="button" className="button button--secondary" onClick={onRetry}>
              {text("重新检查", "Check again")}
            </button>
          )}
          {!previewOnly && (
            <button
              type="button"
              className="button button--primary"
              disabled={readOnly || loading || applying || !preview?.valid}
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
