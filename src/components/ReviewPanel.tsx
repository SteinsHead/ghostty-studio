import { AlertTriangle, ArrowRight, Check, FileCode2, X } from "lucide-react";
import { copyForSetting } from "../settingCopy";
import type { ChangePreview, DraftChange } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface ReviewPanelProps {
  changes: DraftChange[];
  preview: ChangePreview | null;
  loading: boolean;
  applying?: boolean;
  canRecover?: boolean;
  readOnly: boolean;
  onClose(): void;
  onApply(): void;
  onRetry?(): void;
  onRecover?(): void;
}

function readableValue(key: string, values: string[], emptyLabel: string): string {
  const value = values.at(-1);
  if (value == null || value === "") return emptyLabel;
  if (value === "true") return "开启";
  if (value === "false") return "关闭";
  if (key === "background-opacity") {
    const opacity = Number(value);
    if (Number.isFinite(opacity)) return `${Math.round(opacity * 100)}%`;
  }
  if (key === "font-size") return `${value} pt`;
  if (key.startsWith("window-padding")) return `${value} px`;
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
  return value;
}

export function ReviewPanel({
  changes,
  preview,
  loading,
  applying = false,
  canRecover = false,
  readOnly,
  onClose,
  onApply,
  onRetry,
  onRecover,
}: ReviewPanelProps) {
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
        aria-describedby="review-safety-summary"
        aria-busy={loading || applying}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <h2 id="review-title">保存这些更改？</h2>
            <p>{reviewedChanges.length} 项修改将写入当前 Ghostty 配置。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭更改审阅"
            disabled={applying}
            data-dialog-initial-focus
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label="更改审阅内容">
          {loading && !applying && (
            <div className="loading-card" role="status" aria-live="polite">
              正在用 Ghostty 检查配置…
            </div>
          )}
          {applying && (
            <div className="loading-card" role="status" aria-live="polite">
              正在创建恢复点并保存…
            </div>
          )}
          {checkingFailed && (
            <div className="diagnostic" role="alert">
              <AlertTriangle size={15} />
              <span>没有取得可用的检查结果。你的草稿仍然保留，可以重新检查或重新读取配置后再处理。</span>
            </div>
          )}
          {!loading && preview?.valid && (
            <div className="review-validation" role="status">
              <span><Check size={15} /></span>
              <div><strong>Ghostty 验证通过</strong><small>保存前会自动创建一个恢复点。</small></div>
            </div>
          )}

          {!loading && (
            <div className="review-change-list">
              {reviewedChanges.map((change) => {
                const copy = copyForSetting(change.key, "");
                return (
                  <article className="review-change" key={change.key}>
                    <div className="review-change__title">
                      <strong>{copy.label}</strong>
                      {copy.label !== change.key && <code>{change.key}</code>}
                    </div>
                    <div className="review-change__values">
                      <span>{readableValue(change.key, change.before, "未设置")}</span>
                      <ArrowRight size={14} />
                      <strong>{readableValue(change.key, change.after, "从当前文件移除")}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && preview?.diagnostics.map((diagnostic) => (
            <div className="diagnostic" role={preview.valid ? "status" : "alert"} key={diagnostic}>
              {preview.valid ? <Check size={15} /> : <AlertTriangle size={15} />}
              <span>{diagnostic}</span>
            </div>
          ))}

          {!loading && preview?.unifiedDiff && (
            <details className="raw-diff">
              <summary><FileCode2 size={14} /> 查看配置文本变化</summary>
              <pre>{preview.unifiedDiff}</pre>
            </details>
          )}

          <p className="review-safety-copy" id="review-safety-summary">
            保存时会再次确认文件没有被其他应用修改。
          </p>
        </div>

        <footer className="review-footer">
          {readOnly && (
            <span className="readonly-note">当前配置为只读，无法保存。</span>
          )}
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={applying}
          >
            继续编辑
          </button>
          {!loading && !applying && !preview?.valid && canRecover && onRecover && (
            <button type="button" className="button button--secondary" onClick={onRecover}>
              重新读取并保留草稿
            </button>
          )}
          {!loading && !applying && !preview?.valid && (!canRecover || !onRecover) && onRetry && (
            <button type="button" className="button button--secondary" onClick={onRetry}>
              重新检查
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={readOnly || loading || applying || !preview?.valid}
            onClick={onApply}
          >
            {applying ? "正在保存…" : "保存到 Ghostty"}
          </button>
        </footer>
      </section>
    </div>
  );
}
