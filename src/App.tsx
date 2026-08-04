import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileCog,
  FileText,
  Ghost,
  History,
  Layers3,
  PanelLeft,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { backend, isDesktop } from "./backend";
import { ReviewPanel } from "./components/ReviewPanel";
import { ConfigGraphPanel } from "./components/ConfigGraphPanel";
import { SettingRow } from "./components/SettingRow";
import { SnapshotHistoryPanel } from "./components/SnapshotHistoryPanel";
import { TerminalPreview } from "./components/TerminalPreview";
import type {
  ChangePreview,
  ConfigCandidate,
  ConfigGraph,
  ConfigSession,
  DraftChange,
  EnvironmentReport,
  RuntimeOption,
  RuntimeSchema,
  SnapshotInfo,
} from "./types";

function initialValues(options: RuntimeOption[]): Record<string, string> {
  return Object.fromEntries(
    options.map((option) => [
      option.key,
      option.defaultValues[0] ?? "",
    ]),
  );
}

function valuesForSession(
  options: RuntimeOption[],
  session: ConfigSession,
): Record<string, string> {
  const values = initialValues(options);
  for (const [key, configuredValues] of Object.entries(session.values)) {
    if (configuredValues.length > 0 && key in values) {
      values[key] = configuredValues[configuredValues.length - 1];
    }
  }
  return values;
}

function errorMessage(error: unknown): string {
  const friendlyMessages: Record<string, string> = {
    unknown_session: "配置会话已过期，请重新打开应用。",
    revision_conflict: "配置已被其他程序修改，请重新检查后再保存。",
    read_only_session: "当前配置为只读，无法保存。",
    unknown_stage: "检查结果已过期，请重新检查更改。",
    stage_mismatch: "检查结果已过期，请重新检查更改。",
    validation_failed: "Ghostty 没有通过这份配置，请检查提示。",
    validation_failed_after_confirmation: "Ghostty 没有通过这份配置，请检查提示。",
    setting_requires_specialized_editor: "这个设置暂不支持直接编辑。",
    complex_setting_requires_editor: "多值设置暂不支持直接编辑。",
    duplicate_setting_requires_editor: "这个设置在配置中出现了多次，暂时不能直接修改。",
    ghostty_contract_changed: "Ghostty 已更新，设置目录已刷新，请重新检查。",
    ghostty_contract_read_only: "当前 Ghostty 版本尚未适配，设置暂时只读。",
    ghostty_unavailable: "没有找到 Ghostty，暂时无法保存配置。",
    mutation_in_progress: "另一项配置操作正在进行，请稍后再试。",
    native_confirmation_failed: "无法打开系统确认窗口。",
    native_confirmation_cancelled: "已取消保存。",
    snapshot_requires_specialized_restore: "这个快照包含当前版本无法自动恢复的设置。",
    missing_config: "配置文件不存在。",
  };
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && friendlyMessages[code]) return friendlyMessages[code];
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "发生未知错误";
  }
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function matchesMutationUncertainty(code: string | null): boolean {
  return code === "post_commit_conflict"
    || code === "post_commit_unverified"
    || code === "post_write_validation_rollback_failed"
    || code === "post_restore_validation_rollback_failed";
}

function categoryIcon(category: string) {
  if (category.includes("外观")) return Sparkles;
  if (category.includes("安全")) return ShieldCheck;
  if (category.includes("窗口")) return PanelLeft;
  if (category.includes("高级")) return Settings2;
  return SlidersHorizontal;
}

export default function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [environment, setEnvironment] = useState<EnvironmentReport | null>(null);
  const [schema, setSchema] = useState<RuntimeSchema | null>(null);
  const [session, setSession] = useState<ConfigSession | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<ConfigCandidate | null>(null);
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部设置");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [changePreview, setChangePreview] = useState<ChangePreview | null>(null);
  const [configGraph, setConfigGraph] = useState<ConfigGraph | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      backend.probeEnvironment(),
      backend.loadRuntimeSchema(),
      backend.loadConfigGraph(),
    ])
      .then(async ([nextEnvironment, nextSchema, nextGraph]) => {
        if (cancelled) return;
        setEnvironment(nextEnvironment);
        setSchema(nextSchema);
        setConfigGraph(nextGraph);
        const values = initialValues(nextSchema.options);
        const candidate = [...nextEnvironment.candidates]
          .filter((item) => item.exists)
          .sort((a, b) => b.priority - a.priority)[0] ?? null;
        setActiveCandidate(candidate);
        if (candidate) {
          try {
            const opened = await backend.openConfig(candidate.id);
            if (!cancelled) {
              setSession(opened);
              Object.assign(values, valuesForSession(nextSchema.options, opened));
            }
          } catch (openError) {
            if (!cancelled) setError(errorMessage(openError));
          }
        }
        if (!cancelled) {
          setBaseline({ ...values });
          setDraft({ ...values });
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const option of schema?.options ?? []) {
      counts.set(option.category, (counts.get(option.category) ?? 0) + 1);
    }
    return [
      ["全部设置", schema?.options.length ?? 0] as const,
      ...[...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-CN")),
    ];
  }, [schema]);

  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (schema?.options ?? []).filter((option) => {
      const inCategory = category === "全部设置" || option.category === category;
      const searchable = `${option.key} ${option.description} ${option.category}`.toLocaleLowerCase();
      return inCategory && (!needle || searchable.includes(needle));
    });
  }, [schema, category, search]);

  const changes = useMemo<DraftChange[]>(() => {
    return Object.keys(draft)
      .filter((key) => draft[key] !== baseline[key])
      .map((key) => ({
        key,
        before: baseline[key] === undefined ? [] : [baseline[key]],
        after: draft[key] === "" ? [] : [draft[key]],
      }));
  }, [baseline, draft]);

  const previewValues = useMemo<Record<string, string>>(() => ({
    background: draft.background ?? "",
    foreground: draft.foreground ?? "",
    "font-family": draft["font-family"] ?? "",
    "font-size": draft["font-size"] ?? "",
    "background-opacity": draft["background-opacity"] ?? "",
    "window-padding-x": draft["window-padding-x"] ?? "",
    "cursor-style": draft["cursor-style"] ?? "",
  }), [
    draft.background,
    draft.foreground,
    draft["font-family"],
    draft["font-size"],
    draft["background-opacity"],
    draft["window-padding-x"],
    draft["cursor-style"],
  ]);

  const updateDraftValue = useCallback((key: string, value: string) => {
    setDraft((current) => current[key] === value
      ? current
      : { ...current, [key]: value });
  }, []);

  const resetDraftValue = useCallback((key: string, baselineValue: string) => {
    setDraft((current) => current[key] === baselineValue
      ? current
      : { ...current, [key]: baselineValue });
  }, []);

  const openReview = async () => {
    setReviewOpen(true);
    setReviewLoading(true);
    setChangePreview(null);
    try {
      if (!session) throw new Error("尚未打开配置会话");
      const preview = await backend.stageChanges(session.id, session.revision, changes);
      setChangePreview(preview);
    } catch (stageError) {
      setChangePreview({
        token: "",
        revision: session?.revision ?? "",
        changes,
        unifiedDiff: "",
        diagnostics: [errorMessage(stageError)],
        valid: false,
      });
    } finally {
      setReviewLoading(false);
    }
  };

  const applyReviewedChanges = async () => {
    if (!session || !changePreview?.valid) return;
    setReviewLoading(true);
    setWarning(null);
    try {
      const result = await backend.applyChanges(
        session.id,
        session.revision,
        changePreview.token,
      );
      setSession({ ...session, revision: result.revision });
      setBaseline({ ...draft });
      setNotice(
        result.reloadRequired
          ? "已保存。重新加载 Ghostty 后生效。"
          : "已保存。",
      );
      if (result.warnings.length > 0) {
        setWarning(`配置已保存，但系统无法确认数据已完整写入磁盘：${result.warnings.join("；")}`);
      }
      setReviewOpen(false);
      setChangePreview(null);
    } catch (applyError) {
      if (
        matchesMutationUncertainty(errorCode(applyError))
        && activeCandidate
        && schema
      ) {
        try {
          const opened = await backend.openConfig(activeCandidate.id);
          const nextValues = valuesForSession(schema.options, opened);
          setSession(opened);
          setBaseline(nextValues);
          setDraft({ ...nextValues });
          setWarning(
            `无法确认保存结果，已重新读取配置。请检查后重试。${errorMessage(applyError)}`,
          );
        } catch {
          setSession(null);
          setWarning(
            `无法确认保存结果。为避免覆盖其他修改，编辑已暂停；请重启应用。${errorMessage(applyError)}`,
          );
        }
        setReviewOpen(false);
        setChangePreview(null);
        return;
      }
      setChangePreview((current) => ({
        token: current?.token ?? "",
        revision: current?.revision ?? session.revision,
        changes,
        unifiedDiff: current?.unifiedDiff ?? "",
        diagnostics: [...(current?.diagnostics ?? []), errorMessage(applyError)],
        valid: false,
      }));
    } finally {
      setReviewLoading(false);
    }
  };

  const loadSnapshots = async (targetSession: ConfigSession | null = session) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      if (!targetSession) throw new Error("尚未打开配置会话，无法读取快照");
      const nextSnapshots = await backend.listSnapshots(targetSession.id);
      setSnapshots(nextSnapshots);
    } catch (snapshotError) {
      setHistoryError(`读取快照失败：${errorMessage(snapshotError)}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryNotice(null);
    void loadSnapshots();
  };

  const restoreSnapshot = async (snapshot: SnapshotInfo): Promise<boolean> => {
    if (!session || !activeCandidate || !schema) {
      setHistoryError("当前配置会话不可用，请重新打开应用后再恢复。");
      return false;
    }
    if (!isDesktop || session.readOnly) {
      setHistoryError("当前是只读会话，不能恢复快照。");
      return false;
    }

    setRestoringSnapshotId(snapshot.id);
    setHistoryError(null);
    setHistoryNotice(null);
    setWarning(null);

    try {
      const result = await backend.restoreSnapshot(
        session.id,
        session.revision,
        snapshot.id,
      );

      setHistoryNotice(
        "快照已恢复，原配置也已备份。",
      );
      setNotice("已恢复快照。重新加载 Ghostty 后生效。");
      if (result.warnings.length > 0) {
        setWarning(`快照已恢复，但系统无法确认数据已完整写入磁盘：${result.warnings.join("；")}`);
      }
      setChangePreview(null);
      setReviewOpen(false);

      try {
        const opened = await backend.openConfig(activeCandidate.id);
        const nextValues = valuesForSession(schema.options, opened);
        setSession(opened);
        setBaseline(nextValues);
        setDraft({ ...nextValues });
        try {
          setSnapshots(await backend.listSnapshots(opened.id));
        } catch (listError) {
          setHistoryError(`恢复已完成，但快照列表刷新失败：${errorMessage(listError)}`);
        }
      } catch (refreshError) {
        setSession(null);
        setHistoryError(
          `恢复已完成，但配置会话刷新失败。为防止覆盖外部更改，编辑已锁定；请重新打开应用。${errorMessage(refreshError)}`,
        );
      }
      return true;
    } catch (restoreError) {
      if (activeCandidate && schema) {
        try {
          const opened = await backend.openConfig(activeCandidate.id);
          const nextValues = valuesForSession(schema.options, opened);
          setSession(opened);
          setBaseline(nextValues);
          setDraft({ ...nextValues });
        } catch {
          setSession(null);
        }
      }
      setHistoryError(`无法确认恢复结果，已重新读取配置：${errorMessage(restoreError)}`);
      return false;
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  if (loading) {
    return (
      <main className="boot-screen">
        <Ghost size={34} />
        <strong>Ghostty Studio</strong>
        <span>正在读取 Ghostty 配置…</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Ghost size={22} /></div>
          <div><strong>Ghostty Studio</strong><span>Ghostty 配置工具</span></div>
        </div>

        <div className="source-card">
          <div className="source-card__label">正在编辑</div>
          <button type="button" className="source-select" onClick={() => setGraphOpen(true)}>
            <FileText size={16} />
            <span><strong>{activeCandidate?.label ?? "未发现配置"}</strong><small>{activeCandidate?.path ?? "尚未选择配置文件"}</small></span>
            <ChevronRight size={15} />
          </button>
          {(environment?.candidates.filter((item) => item.exists).length ?? 0) > 1 && (
            <div className="layer-warning"><Layers3 size={13} /> 发现多个配置文件</div>
          )}
        </div>

        <nav className="category-nav" aria-label="设置分类">
          <span className="nav-title">设置</span>
          {categories.map(([name, count]) => {
            const Icon = categoryIcon(name);
            return (
              <button
                type="button"
                key={name}
                className={category === name ? "active" : ""}
                onClick={() => setCategory(name)}
              >
                <Icon size={16} />
                <span>{name}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-tools">
          <button type="button" onClick={openHistory}><History size={16} /> 快照历史</button>
          <button type="button" onClick={() => setGraphOpen(true)}><FileCog size={16} /> 配置来源</button>
        </div>

      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索设置或说明…"
              aria-label="搜索设置"
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="runtime-status">
            {environment?.ghostty.available ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>Ghostty {environment?.ghostty.version ?? "未发现"}</span>
          </div>
        </header>

        <div className="content-grid">
          <section className="settings-pane">
            <div className="section-heading">
              <div>
                <h1>{category}</h1>
                <p>修改会先留在草稿里，保存前还可以检查。</p>
              </div>
              {changes.length > 0 && (
                <button className="reset-button" type="button" onClick={() => setDraft(baseline)}>
                  <RotateCcw size={14} /> 撤销全部修改
                </button>
              )}
            </div>

            {error && <div className="error-banner"><AlertCircle size={16} />{error}</div>}
            {notice && <div className="success-banner"><CheckCircle2 size={16} />{notice}</div>}
            {warning && <div className="warning-banner"><AlertCircle size={16} />{warning}</div>}
            {schema?.diagnostics.map((diagnostic) => (
              <div className="info-banner" key={diagnostic}><ShieldCheck size={15} />{diagnostic}</div>
            ))}

            <div className="settings-list">
              {visibleOptions.map((option) => {
                const value = draft[option.key] ?? "";
                const configuredInEditingLayer = (session?.values[option.key]?.length ?? 0) > 0;
                return (
                  <SettingRow
                    key={option.key}
                    option={option}
                    value={value}
                    baselineValue={baseline[option.key] ?? ""}
                    configuredInEditingLayer={configuredInEditingLayer}
                    sourceLabel={activeCandidate?.label ?? "当前编辑层"}
                    onValueChange={updateDraftValue}
                    onReset={resetDraftValue}
                  />
                );
              })}
              {visibleOptions.length === 0 && (
                <div className="empty-state"><Search size={22} /><strong>没有匹配的设置</strong><span>换个关键词试试。</span></div>
              )}
            </div>
          </section>

          <aside className="preview-pane">
            <div className="preview-heading">
              <strong>外观预览</strong>
            </div>
            <TerminalPreview values={previewValues} />

            <div className="change-summary">
              <div className="change-summary__head">
                <strong>待保存</strong><span>{changes.length}</span>
              </div>
              {changes.length === 0 ? (
                <div className="clean-state"><CheckCircle2 size={17} /> 暂无修改</div>
              ) : (
                <div className="change-list">
                  {changes.slice(0, 5).map((change) => (
                    <div key={change.key}><code>{change.key}</code><span>{change.after[0] || "未设置"}</span></div>
                  ))}
                  {changes.length > 5 && <small>另有 {changes.length - 5} 项…</small>}
                </div>
              )}
              <button
                type="button"
                className="button button--primary button--wide"
                disabled={changes.length === 0 || !session}
                onClick={openReview}
              >
                检查更改
              </button>
            </div>

          </aside>
        </div>
      </main>

      {reviewOpen && (
        <ReviewPanel
          changes={changes}
          preview={changePreview}
          loading={reviewLoading}
          readOnly={session?.readOnly ?? true}
          onClose={() => setReviewOpen(false)}
          onApply={applyReviewedChanges}
        />
      )}
      {graphOpen && <ConfigGraphPanel graph={configGraph} onClose={() => setGraphOpen(false)} />}
      {historyOpen && (
        <SnapshotHistoryPanel
          snapshots={snapshots}
          loading={historyLoading}
          error={historyError}
          success={historyNotice}
          readOnly={!isDesktop || (session?.readOnly ?? true)}
          pendingChanges={changes.length}
          restoringId={restoringSnapshotId}
          onClose={() => setHistoryOpen(false)}
          onRetry={() => void loadSnapshots()}
          onRestore={restoreSnapshot}
        />
      )}
    </div>
  );
}
