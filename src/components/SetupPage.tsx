import { AlertCircle, ArrowRight, FilePlus2, Ghost, RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
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
  const { text } = useI18n();
  const ghosttyReady = Boolean(environment?.ghostty.available);
  const existingSources = environment?.candidates.filter((candidate) => candidate.exists) ?? [];
  const hasMultipleSources = existingSources.length > 1;
  const recoveringDraft = pendingChanges > 0;

  const title = recoveringDraft
    ? text("草稿还在，重新连接后即可继续", "Your draft is safe. Reconnect to continue")
    : !ghosttyReady
    ? text("连接 Ghostty 后开始", "Connect Ghostty to get started")
    : hasMultipleSources
      ? text("选择你常用的配置", "Choose the configuration you use")
      : text("打开你的 Ghostty 配置", "Open your Ghostty configuration");
  const description = recoveringDraft
    ? text(
        `${pendingChanges} 项修改仍保留在本次应用中。重新连接原配置后，Studio 会先重新检查。`,
        `${pendingChanges} unsaved ${pendingChanges === 1 ? "change is" : "changes are"} still available in this session. Studio will check ${pendingChanges === 1 ? "it" : "them"} again after reconnecting to the original file.`,
      )
    : !ghosttyReady
    ? text(
        "安装 Ghostty 后重新检查。在确认版本和可用设置之前，Studio 不会改动任何文件。",
        "Install Ghostty, then check again. Studio will not change any files until it confirms the version and available settings.",
      )
    : hasMultipleSources
      ? text(
          "发现了多个配置文件。选择常用的一份，Studio 会记住你的选择。",
          "More than one configuration file was found. Choose the one you normally use and Studio will remember it.",
        )
      : text(
          "打开现有配置，或在 Ghostty 的默认位置安全创建一份新配置。",
          "Open an existing file, or safely create a new one in Ghostty's default location.",
        );

  return (
    <section className="setup-page" aria-labelledby="setup-title">
      <div className="setup-illustration" aria-hidden="true">
        {recoveringDraft || ghosttyReady ? <FilePlus2 size={32} /> : <Ghost size={34} />}
      </div>
      <div className="setup-copy">
        <span className="setup-kicker">
          {recoveringDraft || ghosttyReady ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
          {recoveringDraft
            ? text("编辑已暂停", "Editing paused")
            : ghosttyReady
              ? text("本地处理，可随时恢复", "Local and recoverable")
              : text("尚未连接", "Not connected")}
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
            {refreshing
              ? text("正在重新连接…", "Reconnecting…")
              : text("重新连接并保留草稿", "Reconnect and keep draft")}
          </button>
        ) : ghosttyReady && (
          <button type="button" className="button button--primary" onClick={onChooseSource}>
            {hasMultipleSources
              ? text("选择配置", "Choose configuration")
              : text("打开或创建配置", "Open or create configuration")}
            <ArrowRight size={15} />
          </button>
        )}
        {recoveringDraft ? (
          <button type="button" className="button button--secondary" onClick={onChooseSource}>
            {text("选择其他配置", "Choose another configuration")}
          </button>
        ) : (
          <button
            type="button"
            className="button button--secondary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            {refreshing ? text("正在检查…", "Checking…") : text("重新检查", "Check again")}
          </button>
        )}
      </div>
      <p className="setup-footnote">
        {recoveringDraft
          ? text(
              "草稿只保留在本次打开的应用中。关闭前请重新连接，或明确放弃草稿。",
              "This draft lasts only for the current app session. Reconnect or discard it before closing.",
            )
          : text(
              "Studio 不会自动写入。保存前会由本机 Ghostty 检查，并创建恢复点。",
              "Studio never saves automatically. Your installed Ghostty will check the configuration and a restore point will be created first.",
            )}
      </p>
    </section>
  );
}
