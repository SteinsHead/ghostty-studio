import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  History,
  LockKeyhole,
  RotateCcw,
  X,
} from "lucide-react";
import type { SnapshotInfo } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface SnapshotHistoryPanelProps {
  snapshots: SnapshotInfo[];
  loading: boolean;
  error: string | null;
  success: string | null;
  readOnly: boolean;
  pendingChanges: number;
  restoringId: string | null;
  onClose(): void;
  onRetry(): void;
  onRestore(snapshot: SnapshotInfo): Promise<boolean>;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function formatSnapshotDate(value: number): string {
  const date = new Date(value);
  return Number.isFinite(value) && !Number.isNaN(date.getTime())
    ? dateFormatter.format(date)
    : "时间未知";
}

export function SnapshotHistoryPanel({
  snapshots,
  loading,
  error,
  success,
  readOnly,
  pendingChanges,
  restoringId,
  onClose,
  onRetry,
  onRestore,
}: SnapshotHistoryPanelProps) {
  const [pendingSnapshot, setPendingSnapshot] = useState<SnapshotInfo | null>(null);
  const restoring = restoringId !== null;
  const dialogRef = useDialogFocus(onClose, restoring);

  const confirmRestore = async () => {
    if (!pendingSnapshot || readOnly || restoring) return;
    const restored = await onRestore(pendingSnapshot);
    if (restored) setPendingSnapshot(null);
  };

  return (
    <div
      className="review-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!restoring) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="review-panel history-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <span className="eyebrow"><History size={14} /> 恢复配置</span>
            <h2 id="history-title">快照历史</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={restoring}
            onClick={onClose}
            aria-label="关闭快照历史"
            data-dialog-initial-focus
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label="快照历史内容">
          {readOnly && (
            <div className="history-demo-note">
              <LockKeyhole size={16} />
              <div>
                <strong>演示数据</strong>
                <span>这里显示的是示例快照，无法恢复。</span>
              </div>
            </div>
          )}

          {success && (
            <div className="history-message history-message--success" role="status" aria-live="polite">
              <CheckCircle2 size={16} />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="history-message history-message--error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button type="button" onClick={onRetry} disabled={restoring}>重试</button>
            </div>
          )}

          <div className="history-summary">
            <div>
              <strong>{snapshots.length}</strong>
              <span>{readOnly ? "个示例" : "个可用快照"}</span>
            </div>
            <p>按创建时间从新到旧排列。</p>
          </div>

          {loading ? (
            <div className="loading-card">正在读取快照…</div>
          ) : snapshots.length === 0 ? (
            <div className="history-empty">
              <History size={22} />
              <strong>还没有快照</strong>
              <span>保存配置时会自动创建快照。</span>
            </div>
          ) : (
            <div className="snapshot-list">
              {snapshots.map((snapshot) => {
                const isPending = pendingSnapshot?.id === snapshot.id;
                const isRestoring = restoringId === snapshot.id;
                return (
                  <article className={`snapshot-card ${isPending ? "snapshot-card--pending" : ""}`} key={snapshot.id}>
                    <div className="snapshot-card__main">
                      <div className="snapshot-icon"><FileText size={16} /></div>
                      <div className="snapshot-copy">
                        <strong>{formatSnapshotDate(snapshot.createdAtMs)}</strong>
                        <span>{formatBytes(snapshot.sizeBytes)}</span>
                        <small title={snapshot.id}>快照 {shortId(snapshot.id)}</small>
                      </div>
                      <button
                        type="button"
                        className="button button--secondary snapshot-restore-button"
                        disabled={readOnly || restoring}
                        onClick={() => setPendingSnapshot(snapshot)}
                      >
                        <RotateCcw size={13} />
                        恢复
                      </button>
                    </div>

                    {isPending && !readOnly && (
                      <div className="snapshot-confirm" role="group" aria-label="确认恢复快照">
                        <div>
                          <AlertTriangle size={15} />
                          <p>
                            <strong>恢复这个快照？</strong>
                            <span>
                              恢复前会先备份当前配置。
                              {pendingChanges > 0 ? ` 当前 ${pendingChanges} 项未保存的修改会丢失。` : ""}
                            </span>
                          </p>
                        </div>
                        <div className="snapshot-confirm__actions">
                          <button
                            type="button"
                            className="button button--secondary"
                            disabled={restoring}
                            onClick={() => setPendingSnapshot(null)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            disabled={restoring}
                            onClick={confirmRestore}
                          >
                            {isRestoring ? "正在恢复…" : "确认恢复"}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="review-footer">
          <span className="readonly-note">
            {readOnly ? "演示数据不会写入本机。" : "恢复前会验证配置，并保留当前版本。"}
          </span>
          <button type="button" className="button button--secondary" disabled={restoring} onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
