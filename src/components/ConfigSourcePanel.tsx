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
): string {
  const chinese = locale === "zh-CN";
  if (active && !candidate.exists) return chinese ? "已打开 · 待刷新" : "Open · Refresh needed";
  if (!candidate.exists) {
    return creationAllowed
      ? (chinese ? "可安全创建" : "Ready to create")
      : (chinese ? "需手动创建" : "Create manually");
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
  const hasExistingConfig = (environment?.candidates ?? []).some((candidate) => candidate.exists);
  const canCreate = (candidate: ConfigCandidate) => (
    !candidate.exists
    && candidate.id !== activeCandidate?.id
    && candidate.writable
    && !hasExistingConfig
    && Boolean(environment?.ghostty.available)
    && candidate.path.startsWith("~/")
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
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <h2 id="source-panel-title">{text("选择配置", "Choose configuration")}</h2>
            <p>
              {text(
                "Ghostty Studio 只会修改你在这里选择的文件。",
                "Ghostty Studio will change only the file you choose here.",
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
          {hasExistingConfig && (environment?.candidates.filter((candidate) => candidate.exists).length ?? 0) > 1 && (
            <p className="source-intro">
              {text(
                "发现了多个配置文件。请选择你常用的一份，之后仍可随时切换。",
                "More than one configuration file was found. Choose the one you normally use; you can switch later.",
              )}
            </p>
          )}

          {error && <div className="history-message history-message--error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}

          <div className="candidate-list">
            {(environment?.candidates ?? []).map((candidate) => {
              const active = candidate.id === activeCandidate?.id;
              const creationAllowed = canCreate(candidate);
              const isPending = pendingCandidate?.id === candidate.id;
              const isSwitching = switchingCandidateId === candidate.id;
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
                        {active && <em><Check size={11} /> {text("当前", "Current")}</em>}
                      </span>
                      <small>{sourceDescription(locale, candidate)}</small>
                      <code title={candidate.path}>{candidate.path}</code>
                    </span>
                    <span className={`candidate-state ${candidate.writable && !candidate.symlink ? "candidate-state--ready" : ""}`}>
                      {isSwitching
                        ? (candidate.exists
                            ? text("正在打开…", "Opening…")
                            : text("正在创建…", "Creating…"))
                        : candidateState(locale, candidate, creationAllowed, active)}
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
                        <span>
                          {candidate.exists
                            ? text(
                                "草稿只属于当前配置文件，不会自动带到另一份配置。",
                                "Drafts belong to the current file and do not move to another configuration.",
                              )
                            : text(
                                "Studio 会先让本机 Ghostty 检查空白配置，再请求系统确认。如果文件已存在，创建会停止且不会覆盖。",
                                "Your installed Ghostty will check the blank configuration before the system asks for confirmation. Creation stops if the file already exists and never overwrites it.",
                              )}
                        </span>
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
                  "重新检查后再试。Studio 不会猜测文件路径。",
                  "Check again to retry. Studio will not guess a file path.",
                )}
              </span>
            </div>
          )}

          <details className="source-advanced">
            <summary><GitMerge size={13} /> {text("关于配置来源", "About configuration sources")}</summary>
            <p>
              {text(
                "Ghostty 可以从多个位置加载设置。这里决定 Studio 写入哪一份；其他文件仍可能覆盖它。",
                "Ghostty can load settings from several places. This choice controls where Studio saves; another file may still override it.",
              )}
            </p>
            {(environment?.candidates ?? []).some((candidate) => !candidate.exists) && (
              <p>
                {text(
                  "只有尚无默认配置，并且目标位于用户目录时，Studio 才会创建新文件。",
                  "Studio can create a file only when no default configuration exists and the destination is inside your user folder.",
                )}
              </p>
            )}
            <button type="button" onClick={onOpenGraph}>{text("查看加载详情", "View loading details")}</button>
          </details>
        </div>

        <footer className="review-footer">
          <span className="readonly-note">
            {text("切换配置不会自动保存任何设置。", "Switching configurations never saves settings automatically.")}
          </span>
          <button type="button" className="button button--secondary" disabled={switching} onClick={onClose}>
            {text("完成", "Done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
