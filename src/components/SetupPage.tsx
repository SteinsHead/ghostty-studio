import { AlertCircle, ArrowRight, FilePlus2, RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import type { EnvironmentReport } from "../types";
import { StudioMark } from "./StudioMark";

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
  const canCreateSource = environment?.candidates.some((candidate) => (
    !candidate.exists
    && candidate.writable
    && !candidate.symlink
    && candidate.creationEligible
  )) ?? false;
  const hasExistingSource = existingSources.length > 0;
  const hasMultipleSources = existingSources.length > 1;
  const recoveringDraft = pendingChanges > 0;

  const title = recoveringDraft
    ? text("重新连接以继续编辑", "Reconnect to continue editing")
    : !ghosttyReady
    ? text("连接 Ghostty 后开始", "Connect Ghostty to get started")
    : hasMultipleSources
      ? text("选择你常用的配置", "Choose the configuration you use")
      : hasExistingSource
        ? text("打开你的 Ghostty 配置", "Open your Ghostty configuration")
        : canCreateSource
          ? text("创建你的 Ghostty 配置", "Create your Ghostty configuration")
          : text("检查 Ghostty 配置位置", "Check Ghostty configuration locations");
  const description = recoveringDraft
    ? text(
        `本次会话保留 ${pendingChanges} 项修改。`,
        `${pendingChanges} unsaved ${pendingChanges === 1 ? "change remains" : "changes remain"} in this session.`,
      )
    : !ghosttyReady
    ? text(
        "安装 Ghostty 后重新检查。",
        "Install Ghostty, then check again.",
      )
    : hasMultipleSources
      ? text(
          "发现多份配置，请选择要编辑的一份。",
          "Multiple configurations found. Choose one to edit.",
        )
      : hasExistingSource
        ? text(
            "已找到一份配置，打开后即可开始。",
            "One configuration was found. Open it to continue.",
          )
        : canCreateSource
          ? text(
              "尚未找到配置，可以在安全的默认位置创建一份。",
              "No configuration was found. Create one in a safe default location.",
            )
          : text(
              "当前没有可安全创建的配置位置，请查看检测结果。",
              "No safe configuration location is currently available. Review the detected locations.",
            );

  return (
    <section className="setup-page" aria-labelledby="setup-title">
      <div className="setup-illustration" aria-hidden="true">
        {recoveringDraft || ghosttyReady ? <FilePlus2 size={32} /> : <StudioMark size={38} />}
      </div>
      <div className="setup-copy">
        {(recoveringDraft || !ghosttyReady) && (
          <span className="setup-kicker">
            {recoveringDraft ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
            {recoveringDraft ? text("编辑已暂停", "Editing paused") : text("尚未连接", "Not connected")}
          </span>
        )}
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
            {hasExistingSource
              ? hasMultipleSources
                ? text("选择配置", "Choose configuration")
                : text("打开配置", "Open configuration")
              : canCreateSource
                ? text("创建配置", "Create configuration")
                : text("查看配置位置", "Review locations")}
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
      {recoveringDraft && (
        <p className="setup-footnote">{text("关闭应用会丢失草稿。", "Closing the app will discard this draft.")}</p>
      )}
    </section>
  );
}
