import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  History,
  LockKeyhole,
  RotateCcw,
  X,
} from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
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

function formatBytes(locale: AppLocale, bytes: number): string {
  const format = (value: number) => new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value);
  if (bytes < 1024) return `${format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${format(bytes / 1024)} KB`;
  return `${format(bytes / (1024 * 1024))} MB`;
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function formatSnapshotDate(
  locale: AppLocale,
  formatter: Intl.DateTimeFormat,
  value: number,
): string {
  const date = new Date(value);
  return Number.isFinite(value) && !Number.isNaN(date.getTime())
    ? formatter.format(date)
    : locale === "zh-CN" ? "时间未知" : "Unknown date";
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
  const { locale, text } = useI18n();
  const [pendingSnapshot, setPendingSnapshot] = useState<SnapshotInfo | null>(null);
  const restoring = restoringId !== null;
  const dialogRef = useDialogFocus(onClose, restoring);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

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
            <span className="eyebrow"><History size={14} /> {text("恢复配置", "Restore configuration")}</span>
            <h2 id="history-title">{text("恢复点", "Restore points")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={restoring}
            onClick={onClose}
            aria-label={text("关闭恢复点", "Close restore points")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label={text("恢复点列表", "Restore point list")}>
          {readOnly && (
            <div className="history-demo-note">
              <LockKeyhole size={16} />
              <div>
                <strong>{text("只能查看", "View only")}</strong>
                <span>
                  {text(
                    "当前配置的恢复点无法在这里恢复。",
                    "Restore points for this configuration cannot be restored here.",
                  )}
                </span>
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
              <button type="button" onClick={onRetry} disabled={restoring}>{text("重试", "Try again")}</button>
            </div>
          )}

          <div className="history-summary">
            <div>
              <strong>{snapshots.length}</strong>
              <span>
                {readOnly
                  ? text("个恢复点", snapshots.length === 1 ? "Restore point" : "Restore points")
                  : text("个可用恢复点", snapshots.length === 1 ? "Restore point available" : "Restore points available")}
              </span>
            </div>
            <p>{text("按创建时间从新到旧排列。", "Newest first.")}</p>
          </div>

          {loading ? (
            <div className="loading-card">{text("正在读取恢复点…", "Loading restore points…")}</div>
          ) : snapshots.length === 0 ? (
            <div className="history-empty">
              <History size={22} />
              <strong>{text("还没有恢复点", "No restore points yet")}</strong>
              <span>{text("保存配置时会自动创建恢复点。", "A restore point is created whenever you save.")}</span>
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
                        <strong>{formatSnapshotDate(locale, dateFormatter, snapshot.createdAtMs)}</strong>
                        <span>{formatBytes(locale, snapshot.sizeBytes)}</span>
                        <small title={snapshot.id}>{text("恢复点", "Restore point")} {shortId(snapshot.id)}</small>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          className="button button--secondary snapshot-restore-button"
                          disabled={restoring}
                          onClick={() => setPendingSnapshot(snapshot)}
                        >
                          <RotateCcw size={13} />
                          {text("恢复", "Restore")}
                        </button>
                      )}
                    </div>

                    {isPending && !readOnly && (
                      <div className="snapshot-confirm" role="group" aria-label={text("确认恢复配置", "Confirm restore")}>
                        <div>
                          <AlertTriangle size={15} />
                          <p>
                            <strong>{text("恢复这个版本？", "Restore this version?")}</strong>
                            <span>
                              {text(
                                "恢复前会先备份当前配置。",
                                "The current configuration will be backed up first.",
                              )}
                              {pendingChanges > 0
                                ? text(
                                    ` 当前 ${pendingChanges} 项未保存的修改会丢失。`,
                                    ` ${pendingChanges} unsaved ${pendingChanges === 1 ? "change will" : "changes will"} be discarded.`,
                                  )
                                : ""}
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
                            {text("取消", "Cancel")}
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            disabled={restoring}
                            onClick={confirmRestore}
                          >
                            {isRestoring ? text("正在恢复…", "Restoring…") : text("确认恢复", "Restore")}
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
          {!readOnly && (
            <span className="readonly-note">
              {text(
                "恢复前会检查配置，并保留当前版本。",
                "Studio will check the configuration and preserve the current version before restoring.",
              )}
            </span>
          )}
          <button type="button" className="button button--secondary" disabled={restoring} onClick={onClose}>
            {text("完成", "Done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
