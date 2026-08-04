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
  candidate: ConfigCandidate,
  creationAllowed: boolean,
  active: boolean,
): string {
  if (active && !candidate.exists) return "已打开 · 待刷新";
  if (!candidate.exists) return creationAllowed ? "可安全创建" : "需手动创建";
  if (candidate.symlink) return "符号链接 · 只读";
  if (!candidate.writable) return "只读";
  return "可编辑";
}

function sourceDescription(candidate: ConfigCandidate): string {
  if (candidate.source === "macos") return "macOS Application Support 配置层";
  if (candidate.source === "xdg") return "XDG 配置层，常用于 dotfiles 工作流";
  return "自定义配置层";
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
            <h2 id="source-panel-title">选择配置</h2>
            <p>Ghostty Studio 只会修改你在这里选择的文件。</p>
          </div>
          <button className="icon-button" type="button" disabled={switching} onClick={onClose} aria-label="关闭配置选择" data-dialog-initial-focus>
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label="配置文件列表">
          {hasExistingConfig && (environment?.candidates.filter((candidate) => candidate.exists).length ?? 0) > 1 && (
            <p className="source-intro">检测到多个配置位置。选择你平时使用的一份，之后仍可随时切换。</p>
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
                        {active && <em><Check size={11} /> 当前</em>}
                      </span>
                      <small>{sourceDescription(candidate)}</small>
                      <code title={candidate.path}>{candidate.path}</code>
                    </span>
                    <span className={`candidate-state ${candidate.writable && !candidate.symlink ? "candidate-state--ready" : ""}`}>
                      {isSwitching
                        ? (candidate.exists ? "正在打开…" : "正在创建…")
                        : candidateState(candidate, creationAllowed, active)}
                    </span>
                  </button>

                  {isPending && (
                    <div className="candidate-confirm" role="group" aria-label="确认切换配置文件">
                      <AlertTriangle size={15} />
                      <div>
                        <strong>
                          {candidate.exists
                            ? `切换${pendingChanges > 0 ? `会放弃当前 ${pendingChanges} 项草稿` : "到这个配置文件"}`
                            : `创建空白配置${pendingChanges > 0 ? `并放弃当前 ${pendingChanges} 项草稿` : ""}`}
                        </strong>
                        <span>
                          {candidate.exists
                            ? "草稿只属于当前配置文件，不会自动带到另一个写入目标。"
                            : "应用会先调用当前 Ghostty 验证空白文件，再显示系统确认；若目标已出现则停止，绝不会覆盖。"}
                        </span>
                        <div className="candidate-confirm__actions">
                          <button type="button" className="button button--secondary" disabled={switching} onClick={() => setPendingCandidate(null)}>取消</button>
                          <button
                            type="button"
                            className={pendingChanges > 0 ? "button button--danger" : "button button--primary"}
                            disabled={switching}
                            onClick={() => void confirmSwitch()}
                          >
                            {candidate.exists
                              ? (pendingChanges > 0 ? "放弃并切换" : "切换配置")
                              : (pendingChanges > 0 ? "放弃并创建" : "继续创建")}
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
              <strong>没有发现配置候选</strong>
              <span>重新检查环境后再试；应用不会猜测任意文件路径。</span>
            </div>
          )}

          <details className="source-advanced">
            <summary><GitMerge size={13} /> 关于配置来源</summary>
            <p>Ghostty 可以从多个位置加载设置。这里决定 Studio 写入哪一份；其他文件仍可能覆盖它。</p>
            {(environment?.candidates ?? []).some((candidate) => !candidate.exists) && (
              <p>只有尚无默认配置、且目标位于用户目录时，Studio 才会帮助创建空文件。</p>
            )}
            <button type="button" onClick={onOpenGraph}>查看加载详情</button>
          </details>
        </div>

        <footer className="review-footer">
          <span className="readonly-note">切换配置不会自动保存任何设置。</span>
          <button type="button" className="button button--primary" disabled={switching} onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}
