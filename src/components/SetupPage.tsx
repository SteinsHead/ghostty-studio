import { AlertCircle, ArrowRight, FilePlus2, Ghost, RefreshCw, ShieldCheck } from "lucide-react";
import type { EnvironmentReport } from "../types";

interface SetupPageProps {
  environment: EnvironmentReport | null;
  refreshing: boolean;
  pendingChanges: number;
  onChooseSource(): void;
  onRefresh(): void;
}

export function SetupPage({
  environment,
  refreshing,
  pendingChanges,
  onChooseSource,
  onRefresh,
}: SetupPageProps) {
  const ghosttyReady = Boolean(environment?.ghostty.available);
  const existingSources = environment?.candidates.filter((candidate) => candidate.exists) ?? [];
  const hasMultipleSources = existingSources.length > 1;
  const recoveringDraft = pendingChanges > 0;

  const title = recoveringDraft
    ? "草稿还在，重新连接后继续"
    : !ghosttyReady
    ? "先让 Ghostty Studio 找到 Ghostty"
    : hasMultipleSources
      ? "选择你平时使用的配置"
      : "准备好你的 Ghostty 配置";
  const description = recoveringDraft
    ? `${pendingChanges} 项修改仍保留在本次应用会话中。Studio 不会把它们写到另一份配置；重新连接原配置后会先重新检查。`
    : !ghosttyReady
    ? "安装 Ghostty 后重新检查。应用在确认版本和设置目录之前不会改动任何文件。"
    : hasMultipleSources
      ? "检测到多个配置位置。选择一次后，Ghostty Studio 会记住你的工作区。"
      : "可以打开现有配置，或在 Ghostty 的默认位置安全创建一份空配置。";

  return (
    <section className="setup-page" aria-labelledby="setup-title">
      <div className="setup-illustration" aria-hidden="true">
        {recoveringDraft || ghosttyReady ? <FilePlus2 size={32} /> : <Ghost size={34} />}
      </div>
      <div className="setup-copy">
        <span className="setup-kicker">
          {recoveringDraft || ghosttyReady ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
          {recoveringDraft ? "编辑已安全暂停" : ghosttyReady ? "本地、安全、可恢复" : "尚未连接"}
        </span>
        <h1 id="setup-title">{title}</h1>
        <p>{description}</p>
      </div>
      <div className="setup-actions">
        {recoveringDraft ? (
          <button
            type="button"
            className="button button--primary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            {refreshing ? "正在重新连接…" : "重新连接并保留草稿"}
          </button>
        ) : ghosttyReady && (
          <button type="button" className="button button--primary" onClick={onChooseSource}>
            {hasMultipleSources ? "选择配置" : "打开或创建配置"}
            <ArrowRight size={15} />
          </button>
        )}
        {recoveringDraft ? (
          <button type="button" className="button button--secondary" onClick={onChooseSource}>
            选择其他配置
          </button>
        ) : (
          <button
            type="button"
            className="button button--secondary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            {refreshing ? "正在检查…" : "重新检查"}
          </button>
        )}
      </div>
      <p className="setup-footnote">
        {recoveringDraft
          ? "草稿只保留在本次打开的应用中；关闭前请完成重新连接，或明确放弃草稿。"
          : "不会自动写入。保存前会使用本机 Ghostty 验证，并创建恢复点。"}
      </p>
    </section>
  );
}
