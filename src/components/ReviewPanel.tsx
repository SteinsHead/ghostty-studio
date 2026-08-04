import { AlertTriangle, Check, FileDiff, X } from "lucide-react";
import type { ChangePreview, DraftChange } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface ReviewPanelProps {
  changes: DraftChange[];
  preview: ChangePreview | null;
  loading: boolean;
  readOnly: boolean;
  onClose(): void;
  onApply(): void;
}

export function ReviewPanel({
  changes,
  preview,
  loading,
  readOnly,
  onClose,
  onApply,
}: ReviewPanelProps) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="review-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="review-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <span className="eyebrow"><FileDiff size={14} /> 保存前</span>
            <h2 id="review-title">检查 {changes.length} 项修改</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} data-dialog-initial-focus aria-label="更改审阅内容">
          {loading && <div className="loading-card">正在检查配置…</div>}
          {!loading && changes.map((change) => (
            <article className="diff-card" key={change.key}>
              <code>{change.key}</code>
              <div className="diff-line diff-line--removed">− {change.before.join(", ") || "未设置"}</div>
              <div className="diff-line diff-line--added">+ {change.after.join(", ") || "移除设置"}</div>
            </article>
          ))}

          {preview?.diagnostics.map((diagnostic) => (
            <div className="diagnostic" key={diagnostic}>
              {preview.valid ? <Check size={15} /> : <AlertTriangle size={15} />}
              <span>{diagnostic}</span>
            </div>
          ))}

          <div className="safety-summary">
            <strong>保存前会验证配置并自动创建快照。</strong>
          </div>
        </div>

        <footer className="review-footer">
          {readOnly && (
            <span className="readonly-note">当前配置为只读，无法保存。</span>
          )}
          <button type="button" className="button button--secondary" onClick={onClose}>
            继续编辑
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={readOnly || loading || !preview?.valid}
            onClick={onApply}
          >
            保存更改
          </button>
        </footer>
      </section>
    </div>
  );
}
