import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  GitMerge,
  Link2,
  LockKeyhole,
  X,
} from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import type { ConfigCandidate, EnvironmentReport } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface ConfigSourcePanelProps {
  environment: EnvironmentReport | null;
  activeCandidate: ConfigCandidate | null;
  pendingChanges: number;
  switchingCandidateId: string | null;
  error: string | null;
  onClose(): void;
  onOpenGraph(): void;
  onSelect(candidate: ConfigCandidate): Promise<boolean>;
  onCreate(candidate: ConfigCandidate): Promise<boolean>;
}

function candidateState(
  locale: AppLocale,
  candidate: ConfigCandidate,
  creationAllowed: boolean,
  active: boolean,
  hasExistingConfig: boolean,
  ghosttyAvailable: boolean,
): string {
  const chinese = locale === "zh-CN";
  if (active && !candidate.exists) return chinese ? "已打开 · 待刷新" : "Open · Refresh needed";
  if (!candidate.exists) {
    if (creationAllowed) return chinese ? "可安全创建" : "Ready to create";
    if (hasExistingConfig) return chinese ? "已有其他配置" : "Another configuration exists";
    if (!ghosttyAvailable) return chinese ? "连接 Ghostty 后可创建" : "Connect Ghostty to create";
    if (candidate.symlink) return chinese ? "符号链接 · 不可创建" : "Symlink · Cannot create";
    if (!candidate.writable) return chinese ? "位置不可写" : "Location is not writable";
    return chinese ? "无法安全创建" : "Safe creation unavailable";
  }
  if (candidate.symlink) return chinese ? "符号链接 · 只读" : "Symlink · Read only";
  if (!candidate.writable) return chinese ? "只读" : "Read only";
  return chinese ? "可编辑" : "Editable";
}

function sourceDescription(locale: AppLocale, candidate: ConfigCandidate): string {
  const chinese = locale === "zh-CN";
  if (candidate.source === "macos") {
    return chinese ? "macOS Application Support 配置" : "macOS Application Support configuration";
  }
  if (candidate.source === "xdg") {
    return chinese ? "XDG 配置，常用于 dotfiles" : "XDG configuration, commonly used with dotfiles";
  }
  if (candidate.source === "include") {
    return chinese ? "由 config-file 加载的配置" : "Configuration loaded by config-file";
  }
  return chinese ? "自定义配置" : "Custom configuration";
}

export function ConfigSourcePanel({
  environment,
  activeCandidate,
  pendingChanges,
  switchingCandidateId,
  error,
  onClose,
  onOpenGraph,
  onSelect,
  onCreate,
}: ConfigSourcePanelProps) {
  const { locale, text } = useI18n();
  const [pendingCandidate, setPendingCandidate] = useState<ConfigCandidate | null>(null);
  const switching = switchingCandidateId !== null;
  const ghosttyAvailable = Boolean(environment?.ghostty.available);
  const hasExistingConfig = (environment?.candidates ?? []).some((candidate) => candidate.exists);
  const canCreate = (candidate: ConfigCandidate) => (
    !candidate.exists
    && candidate.id !== activeCandidate?.id
    && candidate.writable
    && !hasExistingConfig
    && ghosttyAvailable
    && candidate.creationEligible
  );
  const dialogRef = useDialogFocus(onClose, switching);

  useEffect(() => {
    setPendingCandidate((current) => {
      if (!current) return current;
      const fresh = environment?.candidates.find((candidate) => candidate.id === current.id);
      if (!fresh || fresh.id === activeCandidate?.id || fresh.exists !== current.exists) return null;
      return fresh;
    });
  }, [activeCandidate?.id, environment]);

  const chooseCandidate = async (candidate: ConfigCandidate) => {
    if (candidate.id === activeCandidate?.id || switching) return;
    if (!candidate.exists) {
      if (canCreate(candidate)) setPendingCandidate(candidate);
      return;
    }
    if (pendingChanges > 0) {
      setPendingCandidate(candidate);
      return;
    }
    if (await onSelect(candidate)) onClose();
  };

  const confirmSwitch = async () => {
    if (!pendingCandidate || switching) return;
    const completed = pendingCandidate.exists
      ? await onSelect(pendingCandidate)
      : await onCreate(pendingCandidate);
    if (completed) {
      setPendingCandidate(null);
      onClose();
    }
  };

  return (
    <div className="review-backdrop" role="presentation" onMouseDown={() => !switching && onClose()}>
      <section
        ref={dialogRef}
        className="review-panel source-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-panel-title"
        aria-busy={switching}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <h2 id="source-panel-title">{text("选择写入位置", "Choose write location")}</h2>
            <p>
              {text(
                "Ghostty 可能同时加载多份配置。",
                "Ghostty may load more than one configuration.",
              )}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={switching}
            onClick={onClose}
            aria-label={text("关闭配置选择", "Close configuration picker")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label={text("配置文件列表", "Configuration files")}>
          {error && <div className="history-message history-message--error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}

          <div className="candidate-list">
            {(environment?.candidates ?? []).map((candidate) => {
              const active = candidate.id === activeCandidate?.id;
              const creationAllowed = canCreate(candidate);
              const isPending = pendingCandidate?.id === candidate.id;
              const isSwitching = switchingCandidateId === candidate.id;
              const ready = candidate.exists
                ? candidate.writable && !candidate.symlink
                : creationAllowed;
              return (
                <article className={`candidate-card ${active ? "candidate-card--active" : ""} ${isPending ? "candidate-card--pending" : ""}`} key={candidate.id}>
                  <button
                    type="button"
                    className="candidate-card__select"
                    disabled={(!candidate.exists && !creationAllowed) || switching}
                    aria-current={active ? "true" : undefined}
                    onClick={() => void chooseCandidate(candidate)}
                  >
                    <span className="candidate-icon">{candidate.symlink ? <Link2 size={16} /> : <FileText size={16} />}</span>
                    <span className="candidate-copy">
                      <span className="candidate-title">
                        <strong>{candidate.label}</strong>
                        {active && <em><Check size={11} /> {text("保存到这里", "Save destination")}</em>}
                      </span>
                      <small>{sourceDescription(locale, candidate)}</small>
                    </span>
                    <span
                      className={`candidate-state ${ready ? "candidate-state--ready" : ""}`}
                      role={isSwitching ? "status" : undefined}
                      aria-live={isSwitching ? "polite" : undefined}
                      aria-atomic={isSwitching ? "true" : undefined}
                    >
                      {isSwitching
                        ? (candidate.exists
                            ? text("正在打开…", "Opening…")
                            : text("正在创建…", "Creating…"))
                        : candidateState(
                            locale,
                            candidate,
                            creationAllowed,
                            active,
                            hasExistingConfig,
                            ghosttyAvailable,
                          )}
                    </span>
                  </button>

                  {isPending && (
                    <div
                      className="candidate-confirm"
                      role="group"
                      aria-label={text("确认切换配置文件", "Confirm configuration change")}
                    >
                      <AlertTriangle size={15} />
                      <div>
                        <strong>
                          {candidate.exists
                            ? pendingChanges > 0
                              ? text(
                                  `切换会放弃当前 ${pendingChanges} 项草稿`,
                                  `Switching will discard ${pendingChanges} draft ${pendingChanges === 1 ? "change" : "changes"}`,
                                )
                              : text("切换到这个配置文件？", "Switch to this configuration?")
                            : pendingChanges > 0
                              ? text(
                                  `创建新配置并放弃当前 ${pendingChanges} 项草稿？`,
                                  `Create a new configuration and discard ${pendingChanges} draft ${pendingChanges === 1 ? "change" : "changes"}?`,
                                )
                              : text("创建新的空白配置？", "Create a new blank configuration?")}
                        </strong>
                        {!candidate.exists && (
                          <span>{text(
                            "创建前会由 Ghostty 检查；不会覆盖已有文件。",
                            "Ghostty will validate the file before creation. Existing files will not be overwritten.",
                          )}</span>
                        )}
                        <div className="candidate-confirm__actions">
                          <button type="button" className="button button--secondary" disabled={switching} onClick={() => setPendingCandidate(null)}>
                            {text("取消", "Cancel")}
                          </button>
                          <button
                            type="button"
                            className={pendingChanges > 0 ? "button button--danger" : "button button--primary"}
                            disabled={switching}
                            onClick={() => void confirmSwitch()}
                          >
                            {candidate.exists
                              ? (pendingChanges > 0
                                  ? text("放弃并切换", "Discard and switch")
                                  : text("切换配置", "Switch configuration"))
                              : (pendingChanges > 0
                                  ? text("放弃并创建", "Discard and create")
                                  : text("继续创建", "Continue"))}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {(environment?.candidates.length ?? 0) === 0 && (
            <div className="history-empty">
              <LockKeyhole size={22} />
              <strong>{text("没有找到配置文件", "No configuration files found")}</strong>
              <span>
                {text(
                  "重新检查后再试。",
                  "Check again to retry.",
                )}
              </span>
            </div>
          )}

          <details className="source-advanced">
            <summary><GitMerge size={13} /> {text("关于配置来源", "About configuration sources")}</summary>
            <p>
              {text(
                "写入位置不一定是最终生效来源；保存前会检查覆盖关系。",
                "The write location may not be the effective source. Overrides are checked before saving.",
              )}
            </p>
            {(environment?.candidates ?? []).some((candidate) => !candidate.exists) && (
              <p>
                {text(
                  "仅在用户目录内且没有默认配置时创建新文件。",
                  "New files are created only in your user folder when no default configuration exists.",
                )}
              </p>
            )}
            <button type="button" onClick={onOpenGraph}>{text("查看加载详情", "View loading details")}</button>
          </details>
        </div>

        <footer className="review-footer">
          <button type="button" className="button button--secondary" disabled={switching} onClick={onClose}>
            {text("完成", "Done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
