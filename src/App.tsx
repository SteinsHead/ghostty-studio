import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileCog,
  FileText,
  Ghost,
  History,
  Layers3,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { backend, isDesktop } from "./backend";
import { ConfigSourcePanel } from "./components/ConfigSourcePanel";
import { ConfigGraphPanel } from "./components/ConfigGraphPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { SetupPage } from "./components/SetupPage";
import { SettingRow } from "./components/SettingRow";
import { SnapshotHistoryPanel } from "./components/SnapshotHistoryPanel";
import { TerminalPreview } from "./components/TerminalPreview";
import {
  compareCompatibility,
  createCompatibilitySnapshot,
  deriveWorkspaceSummary,
  isGenericallyEditable,
  loadCompatibilitySnapshot,
  saveCompatibilitySnapshot,
} from "./productModel";
import type { CompatibilityChange } from "./productModel";
import { changeSetsEqual, ReviewGuard } from "./reviewGuard";
import { copyForSetting } from "./settingCopy";
import {
  chooseStartupCandidate,
  chooseWorkspaceCandidate,
  COMMON_SETTING_KEYS,
  isCommonSetting,
  PREVIEW_SETTING_KEYS,
} from "./workspaceModel";
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

const LAST_CATEGORY_KEY = "ghostty-studio:last-category";
const PREFERRED_CANDIDATE_KEY = "ghostty-studio:preferred-candidate";

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences improve continuity but never block configuration work.
  }
}

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
    invalid_candidate: "配置目标标识无效，请重新检查环境。",
    unknown_candidate: "配置目标已经过期，请重新检查环境。",
    state_poisoned: "应用的本地状态暂时不可用；请重新启动应用后再试。",
    schema_not_loaded: "设置目录尚未准备好，请重新检查环境。",
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
    native_confirmation_cancelled: "已取消操作。",
    snapshot_requires_specialized_restore: "这个快照包含当前版本无法自动恢复的设置。",
    missing_config: "配置文件不存在。",
    config_already_exists: "目标配置已经出现；为避免覆盖，请重新检查环境。",
    existing_config_prevents_creation: "已经存在一份默认配置；为避免形成意外的多层配置，暂不自动创建另一份。",
    config_creation_not_allowed: "这个路径不符合安全创建条件，可以由你手动创建后再重新检查。",
    creation_outside_home: "安全创建只支持用户目录内的默认 Ghostty 路径。",
    creation_outside_approved_root: "安全创建只支持用户目录内的默认 Ghostty 路径。",
    relative_xdg_config_home: "XDG_CONFIG_HOME 使用了相对路径；为避免创建到意外位置，请先改为绝对路径或手动创建。",
    non_utf8_config_root: "配置根目录不能无损表示为 UTF-8；为避免写到错误路径，已禁用自动创建。",
    home_unavailable: "无法确认用户目录，已停止自动创建。",
    invalid_creation_root: "配置根目录不可用、是符号链接或不满足安全要求，应用不会自动创建。",
    invalid_creation_parent: "配置目录包含符号链接或非目录节点，应用不会自动创建。",
    invalid_target: "目标配置路径不符合安全创建要求。",
    candidate_changed: "确认期间配置位置或状态发生了变化；没有继续创建，请重新检查。",
    baseline_validation_failed: "Ghostty 当前的默认配置本身未通过验证；没有创建文件。",
    config_creation_not_supported: "当前平台暂不支持安全自动创建，请手动创建后重新检查。",
    config_creation_failed: "无法安全创建配置文件；没有覆盖已有内容。",
    post_creation_validation_failed: "创建后的完整 Ghostty 配置未通过验证；为避免误删竞争写入，空文件已保留，请重新检查后手动处理。",
    post_creation_conflict: "配置创建后立即被其他程序修改；较新的文件已保留，请重新检查。",
    post_creation_unverified: "配置可能已创建，但无法读回确认；请重新检查环境。",
    post_creation_rollback_failed: "创建后的验证失败，且无法确认是否已安全撤回；请先重新检查环境，不要盲目重试。",
    creation_rollback_failed: "无法确认是否已撤回新建的空配置；请重新检查环境。",
    config_too_large: "配置文件超过安全读取上限，应用不会继续处理。",
    invalid_encoding: "配置文件不是有效的 UTF-8，当前版本不会改写它。",
    io_error: "本地文件操作没有完成；实际状态可能已变化，应用会重新检查。",
    ghostty_schema_failed: "Ghostty 设置目录读取失败，请重新检查安装状态。",
    ghostty_spawn_failed: "无法启动 Ghostty 验证进程，请重新检查安装状态。",
    ghostty_pipe_failed: "无法安全读取 Ghostty 验证结果。",
    ghostty_pipe_timeout: "Ghostty 验证输出读取超时，已停止操作。",
    ghostty_timeout: "Ghostty 验证超时，已停止操作。",
    ghostty_output_too_large: "Ghostty 验证输出超过安全上限，已停止操作。",
    no_effective_changes: "当前草稿没有改变这个配置文件。",
    post_validation_conflict: "完成验证期间配置被其他程序修改；外部修改已保留，请重新检查草稿。",
    post_validation_unverified: "写入后无法确认最终文件状态；编辑已安全暂停，请重新读取配置。",
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
    || code === "post_validation_conflict"
    || code === "post_validation_unverified"
    || code === "post_write_validation_rollback_failed"
    || code === "post_restore_validation_rollback_failed";
}

async function loadWorkspaceResources() {
  const [environmentResult, schemaResult, graphResult] = await Promise.allSettled([
    backend.probeEnvironment(),
    backend.loadRuntimeSchema(),
    backend.loadConfigGraph(),
  ]);
  const environmentError = environmentResult.status === "rejected"
    ? `环境检查失败：${errorMessage(environmentResult.reason)}`
    : null;
  const schemaError = schemaResult.status === "rejected"
    ? `设置目录读取失败：${errorMessage(schemaResult.reason)}`
    : null;
  const graphError = graphResult.status === "rejected"
    ? `配置来源读取失败：${errorMessage(graphResult.reason)}`
    : null;
  return {
    environment: environmentResult.status === "fulfilled" ? environmentResult.value : null,
    schema: schemaResult.status === "fulfilled" ? schemaResult.value : null,
    graph: graphResult.status === "fulfilled" ? graphResult.value : null,
    graphError,
    errors: [environmentError, schemaError, graphError].filter(
      (message): message is string => Boolean(message),
    ),
  };
}

function categoryIcon(category: string) {
  if (category === "常用") return Star;
  if (category === "我的配置") return FileText;
  if (category === "设置参考") return BookOpen;
  if (category.includes("外观")) return Sparkles;
  if (category.includes("安全")) return ShieldCheck;
  if (category.includes("窗口")) return PanelLeft;
  if (category.includes("高级")) return Settings2;
  return SlidersHorizontal;
}

export default function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentGridRef = useRef<HTMLDivElement>(null);
  const settingsPaneRef = useRef<HTMLElement>(null);
  const reviewGuardRef = useRef(new ReviewGuard());
  const openReviewRef = useRef<() => void>(() => undefined);
  const dialogOpenRef = useRef(false);
  const changesRef = useRef<DraftChange[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentReport | null>(null);
  const [schema, setSchema] = useState<RuntimeSchema | null>(null);
  const [session, setSession] = useState<ConfigSession | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<ConfigCandidate | null>(null);
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => readPreference(LAST_CATEGORY_KEY) ?? "常用");
  const [previewMode, setPreviewMode] = useState<"saved" | "draft">("draft");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reviewFailureCode, setReviewFailureCode] = useState<string | null>(null);
  const [changePreview, setChangePreview] = useState<ChangePreview | null>(null);
  const [configGraph, setConfigGraph] = useState<ConfigGraph | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [switchingCandidateId, setSwitchingCandidateId] = useState<string | null>(null);
  const [compatibilityChange, setCompatibilityChange] = useState<CompatibilityChange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discardedDraft, setDiscardedDraft] = useState<Record<string, string> | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);

  dialogOpenRef.current = reviewOpen || graphOpen || sourcePanelOpen || historyOpen;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (dialogOpenRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        openReviewRef.current();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useLayoutEffect(() => {
    if (contentGridRef.current) contentGridRef.current.scrollTop = 0;
    if (settingsPaneRef.current) settingsPaneRef.current.scrollTop = 0;
  }, [category, search]);

  useEffect(() => {
    let cancelled = false;
    loadWorkspaceResources()
      .then(async (resources) => {
        if (cancelled) return;
        setEnvironment(resources.environment);
        setSchema(resources.schema);
        setConfigGraph(resources.graph);
        setGraphError(resources.graph ? null : resources.graphError ?? "配置来源暂时不可用");
        const values = initialValues(resources.schema?.options ?? []);
        const candidate = resources.environment
          ? chooseStartupCandidate(
              resources.environment.candidates,
              readPreference(PREFERRED_CANDIDATE_KEY),
            )
          : null;
        setActiveCandidate(candidate);
        if (candidate && resources.schema) {
          try {
            const opened = await backend.openConfig(candidate.id);
            if (!cancelled) {
              setSession(opened);
              Object.assign(values, valuesForSession(resources.schema.options, opened));
            }
          } catch (openError) {
            if (!cancelled) setError(errorMessage(openError));
          }
        }
        if (!cancelled) {
          if (resources.errors.length > 0) setWarning(resources.errors.join("；"));
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
    const preferredOrder = ["外观", "字体", "窗口", "光标", "鼠标与滚动", "快捷键", "隐私与安全"];
    return [...counts.entries()].sort(([a], [b]) => {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) {
        if (aIndex < 0) return 1;
        if (bIndex < 0) return -1;
        return aIndex - bIndex;
      }
      return a.localeCompare(b, "zh-CN");
    });
  }, [schema]);

  useEffect(() => {
    if (!schema) return;
    const validCategories = new Set([
      "常用",
      "我的配置",
      "设置参考",
      ...categories.map(([name]) => name),
    ]);
    if (!validCategories.has(category)) setCategory("常用");
  }, [category, categories, schema]);

  useEffect(() => {
    if (category) writePreference(LAST_CATEGORY_KEY, category);
  }, [category]);

  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const options = (schema?.options ?? []).filter((option) => {
      const copy = copyForSetting(option.key, option.description);
      const searchable = `${option.key} ${copy.label} ${copy.summary ?? ""} ${option.description} ${option.category}`.toLocaleLowerCase();
      if (needle) return searchable.includes(needle);
      if (category === "常用") return isCommonSetting(option);
      if (category === "我的配置") return (session?.values[option.key]?.length ?? 0) > 0;
      if (category === "设置参考") return true;
      return option.category === category;
    });
    if (!needle && category === "常用") {
      return options.sort((a, b) => (
        COMMON_SETTING_KEYS.indexOf(a.key as typeof COMMON_SETTING_KEYS[number])
        - COMMON_SETTING_KEYS.indexOf(b.key as typeof COMMON_SETTING_KEYS[number])
      ));
    }
    return options;
  }, [schema, category, search, session]);

  const optionGroups = useMemo(() => {
    const grouped = new Map<string, RuntimeOption[]>();
    for (const option of visibleOptions) {
      const group = search || category === "常用" || category === "我的配置" || category === "设置参考"
        ? option.category
        : "";
      const items = grouped.get(group) ?? [];
      items.push(option);
      grouped.set(group, items);
    }
    return [...grouped.entries()];
  }, [category, search, visibleOptions]);

  const changes = useMemo<DraftChange[]>(() => {
    return Object.keys(draft)
      .filter((key) => draft[key] !== baseline[key])
      .map((key) => ({
        key,
        before: session?.values[key] ?? [],
        after: draft[key] === "" ? [] : [draft[key]],
      }));
  }, [baseline, draft, session]);

  changesRef.current = changes;

  const workspaceSummary = useMemo(() => deriveWorkspaceSummary(
    environment,
    schema,
    session,
    configGraph,
    isDesktop,
  ), [environment, schema, session, configGraph]);

  useEffect(() => {
    if (!isDesktop || !schema || schema.options.length === 0 || schema.schemaHash === "offline") return;
    try {
      const current = createCompatibilitySnapshot(schema);
      const storage = window.localStorage;
      const previous = loadCompatibilitySnapshot(storage);
      setCompatibilityChange(compareCompatibility(previous, current));
      saveCompatibilitySnapshot(storage, current);
    } catch {
      // Compatibility history is helpful metadata, never a startup dependency.
      setCompatibilityChange(null);
    }
  }, [schema]);

  useEffect(() => {
    if (changes.length === 0) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [changes.length]);

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

  const savedPreviewValues = useMemo<Record<string, string>>(() => ({
    background: baseline.background ?? "",
    foreground: baseline.foreground ?? "",
    "font-family": baseline["font-family"] ?? "",
    "font-size": baseline["font-size"] ?? "",
    "background-opacity": baseline["background-opacity"] ?? "",
    "window-padding-x": baseline["window-padding-x"] ?? "",
    "cursor-style": baseline["cursor-style"] ?? "",
  }), [
    baseline.background,
    baseline.foreground,
    baseline["font-family"],
    baseline["font-size"],
    baseline["background-opacity"],
    baseline["window-padding-x"],
    baseline["cursor-style"],
  ]);

  const showPreview = useMemo(() => {
    if (search) return visibleOptions.some((option) => PREVIEW_SETTING_KEYS.has(option.key));
    return category === "常用"
      || category.includes("外观")
      || category.includes("字体")
      || category.includes("窗口")
      || category.includes("光标");
  }, [category, search, visibleOptions]);

  const pageTitle = search ? "搜索" : category;
  const pageDescription = search
    ? `${visibleOptions.length} 个匹配结果，按类别整理。`
    : category === "常用"
      ? "日常最常调整的外观、字体与窗口选项。"
      : category === "我的配置"
        ? "当前配置文件中明确写入的设置。"
        : category === "设置参考"
          ? "浏览本机 Ghostty 支持的完整目录；未适配的设置保持只读。"
          : `调整 Ghostty 的${category}体验。`;

  const updateDraftValue = useCallback((key: string, value: string) => {
    reviewGuardRef.current.invalidate();
    setNotice(null);
    setDiscardedDraft(null);
    setDraft((current) => current[key] === value
      ? current
      : { ...current, [key]: value });
  }, []);

  const resetDraftValue = useCallback((key: string, baselineValue: string) => {
    reviewGuardRef.current.invalidate();
    setNotice(null);
    setDiscardedDraft(null);
    setDraft((current) => current[key] === baselineValue
      ? current
      : { ...current, [key]: baselineValue });
  }, []);

  const resetAllDraft = useCallback(() => {
    reviewGuardRef.current.invalidate();
    setDiscardedDraft({ ...draft });
    setNotice(`已放弃 ${changes.length} 项修改。`);
    setReviewOpen(false);
    setChangePreview(null);
    setReviewFailureCode(null);
    setDraft({ ...baseline });
  }, [baseline, changes.length, draft]);

  const undoDiscardedDraft = useCallback(() => {
    if (!discardedDraft) return;
    reviewGuardRef.current.invalidate();
    setDraft(discardedDraft);
    setDiscardedDraft(null);
    setNotice("已恢复刚才的草稿。");
  }, [discardedDraft]);

  const closeReview = () => {
    if (applying) return;
    reviewGuardRef.current.invalidate();
    setReviewOpen(false);
    setReviewLoading(false);
    setReviewFailureCode(null);
    setChangePreview(null);
  };

  const refreshWorkspace = async (preserveDraft = true): Promise<boolean> => {
    if (refreshing || applying) return false;
    const capturedChanges = changes.map((change) => ({
      ...change,
      before: [...change.before],
      after: [...change.after],
    }));
    reviewGuardRef.current.invalidate();
    setRefreshing(true);
    setError(null);
    setWarning(null);
    setReviewOpen(false);
    setChangePreview(null);
    setReviewFailureCode(null);
    try {
      const resources = await loadWorkspaceResources();
      setEnvironment(resources.environment);
      setSchema(resources.schema);
      setConfigGraph(resources.graph);
      setGraphError(resources.graph ? null : resources.graphError ?? "配置来源暂时不可用");

      const previousCandidate = activeCandidate;
      const candidate = resources.environment
        ? chooseWorkspaceCandidate(
            resources.environment.candidates,
            previousCandidate?.id ?? null,
            readPreference(PREFERRED_CANDIDATE_KEY),
          )
        : null;
      const hasRecoverableDraft = preserveDraft && capturedChanges.length > 0;
      const sameCandidate = Boolean(
        previousCandidate && candidate && previousCandidate.id === candidate.id,
      );

      if (hasRecoverableDraft && (!sameCandidate || !resources.schema)) {
        setActiveCandidate(sameCandidate ? candidate : null);
        setSession(null);
        setNotice(null);
        setSourceError(null);
        const reason = !resources.schema
          ? "设置目录暂时不可用"
          : "原配置位置已经变化";
        setWarning([
          `${reason}，${capturedChanges.length} 项草稿仍保留在本次应用会话中。重新连接原配置，或明确选择其他配置后再继续。`,
          ...resources.errors,
        ].join("；"));
        return true;
      }

      const nextValues = initialValues(resources.schema?.options ?? []);
      let opened: ConfigSession | null = null;
      if (candidate && resources.schema) {
        try {
          opened = await backend.openConfig(candidate.id);
          Object.assign(nextValues, valuesForSession(resources.schema.options, opened));
        } catch (openError) {
          setActiveCandidate(candidate);
          setSession(null);
          if (hasRecoverableDraft) {
            setWarning(
              `暂时无法重新打开 ${candidate.label}；${capturedChanges.length} 项草稿仍保留在本次应用会话中。${errorMessage(openError)}`,
            );
            return false;
          }
          throw openError;
        }
      }
      setActiveCandidate(candidate);
      setSession(opened);
      setBaseline({ ...nextValues });

      const nextDraft = { ...nextValues };
      let preservedCount = 0;
      if (hasRecoverableDraft && sameCandidate && resources.schema) {
        const options = new Map(resources.schema.options.map((option) => [option.key, option]));
        for (const change of capturedChanges) {
          const option = options.get(change.key);
          if (!option || !isGenericallyEditable(option) || change.after.length > 1) continue;
          nextDraft[change.key] = change.after[0] ?? "";
          if (nextDraft[change.key] !== nextValues[change.key]) preservedCount += 1;
        }
      }
      setDraft(nextDraft);
      setNotice(
        preservedCount > 0
          ? `已重新读取环境并保留 ${preservedCount} 项兼容草稿，请重新检查。`
          : "已重新检查 Ghostty、设置目录和配置来源。",
      );
      setSourceError(null);
      if (resources.errors.length > 0) setWarning(resources.errors.join("；"));
      return true;
    } catch (refreshError) {
      setError(`重新检查失败：${errorMessage(refreshError)}`);
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  const switchCandidate = async (candidate: ConfigCandidate): Promise<boolean> => {
    if (!schema || switchingCandidateId || applying) return false;
    reviewGuardRef.current.invalidate();
    setSwitchingCandidateId(candidate.id);
    setSourceError(null);
    try {
      const opened = await backend.openConfig(candidate.id);
      const nextValues = valuesForSession(schema.options, opened);
      setActiveCandidate(candidate);
      writePreference(PREFERRED_CANDIDATE_KEY, candidate.id);
      setSession(opened);
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setChangePreview(null);
      setReviewOpen(false);
      setNotice(`已切换到 ${candidate.label}；尚未写入任何内容。`);
      setWarning(null);
      setError(null);
      return true;
    } catch (switchError) {
      setSourceError(errorMessage(switchError));
      return false;
    } finally {
      setSwitchingCandidateId(null);
    }
  };

  const createCandidate = async (candidate: ConfigCandidate): Promise<boolean> => {
    if (!schema || switchingCandidateId || applying || !isDesktop) return false;
    reviewGuardRef.current.invalidate();
    setSwitchingCandidateId(candidate.id);
    setSourceError(null);
    try {
      const opened = await backend.createConfig(candidate.id);
      const [environmentResult, graphResult] = await Promise.allSettled([
        backend.probeEnvironment(),
        backend.loadConfigGraph(),
      ]);
      if (environmentResult.status === "fulfilled") {
        setEnvironment(environmentResult.value);
        setActiveCandidate(
          environmentResult.value.candidates.find((item) => item.id === opened.candidateId)
            ?? null,
        );
      } else {
        // A successfully opened backend session is authoritative evidence that
        // this exact issued candidate exists, even if the follow-up probe failed.
        setActiveCandidate({
          ...candidate,
          exists: true,
          writable: !opened.readOnly,
          symlink: false,
          sizeBytes: 0,
        });
      }
      if (graphResult.status === "fulfilled") {
        setConfigGraph(graphResult.value);
        setGraphError(null);
      } else {
        setConfigGraph(null);
        setGraphError(`配置已创建，但来源图刷新失败：${errorMessage(graphResult.reason)}`);
      }
      setSession(opened);
      writePreference(PREFERRED_CANDIDATE_KEY, opened.candidateId);
      const nextValues = valuesForSession(schema.options, opened);
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setChangePreview(null);
      setReviewOpen(false);
      setNotice(`已创建并打开 ${candidate.label}；尚未写入任何设置。`);
      const creationWarnings = opened.diagnostics.filter((diagnostic) => (
        diagnostic.includes("fsync") || diagnostic.includes("耐久性")
      ));
      if (environmentResult.status === "rejected") {
        creationWarnings.push(`配置已创建，但环境刷新失败：${errorMessage(environmentResult.reason)}`);
      }
      setWarning(creationWarnings.length > 0 ? creationWarnings.join("；") : null);
      setError(null);
      return true;
    } catch (createError) {
      const code = errorCode(createError);
      let message = errorMessage(createError);
      if (code !== "native_confirmation_cancelled") {
        const [environmentResult, schemaResult, graphResult] = await Promise.allSettled([
          backend.probeEnvironment(),
          backend.loadRuntimeSchema(),
          backend.loadConfigGraph(),
        ]);
        if (environmentResult.status === "fulfilled") {
          setEnvironment(environmentResult.value);
          message += " 已重新读取真实配置状态；内存草稿没有被丢弃。";
        } else {
          message += ` 环境重新检查失败：${errorMessage(environmentResult.reason)}`;
        }
        if (schemaResult.status === "fulfilled" && schemaResult.value.schemaHash !== schema?.schemaHash) {
          const defaults = initialValues(schemaResult.value.options);
          setSchema(schemaResult.value);
          setBaseline((current) => ({ ...defaults, ...current }));
          setDraft((current) => ({ ...defaults, ...current }));
          message += " Ghostty 设置契约也发生了变化，保存前需要重新检查。";
        }
        if (graphResult.status === "fulfilled") {
          setConfigGraph(graphResult.value);
          setGraphError(null);
        } else {
          setGraphError(`配置来源刷新失败：${errorMessage(graphResult.reason)}`);
        }
      }
      setSourceError(message);
      return false;
    } finally {
      setSwitchingCandidateId(null);
    }
  };

  const openReview = async () => {
    if (changes.length === 0 || reviewLoading || applying) return;
    const requestId = reviewGuardRef.current.begin();
    const reviewedChanges = changes.map((change) => ({
      ...change,
      before: [...change.before],
      after: [...change.after],
    }));
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewFailureCode(null);
    setChangePreview(null);
    try {
      if (!session) throw new Error("尚未打开配置会话");
      const preview = await backend.stageChanges(session.id, session.revision, reviewedChanges);
      if (!reviewGuardRef.current.isCurrent(requestId)) return;
      if (!changeSetsEqual(reviewedChanges, changesRef.current)) {
        setReviewFailureCode("draft_changed");
        setChangePreview({
          token: "",
          revision: session.revision,
          changes: reviewedChanges,
          unifiedDiff: "",
          diagnostics: ["检查期间草稿发生了变化，旧结果已作废。请重新检查。"],
          valid: false,
        });
        return;
      }
      setChangePreview(preview);
    } catch (stageError) {
      if (!reviewGuardRef.current.isCurrent(requestId)) return;
      setReviewFailureCode(errorCode(stageError));
      setChangePreview({
        token: "",
        revision: session?.revision ?? "",
        changes: reviewedChanges,
        unifiedDiff: "",
        diagnostics: [errorMessage(stageError)],
        valid: false,
      });
    } finally {
      if (reviewGuardRef.current.isCurrent(requestId)) setReviewLoading(false);
    }
  };

  openReviewRef.current = () => {
    if (session && changesRef.current.length > 0) void openReview();
  };

  const applyReviewedChanges = async () => {
    if (!session || !changePreview?.valid) return;
    if (!changeSetsEqual(changePreview.changes, changesRef.current)) {
      setReviewFailureCode("draft_changed");
      setChangePreview((current) => current ? {
        ...current,
        token: "",
        valid: false,
        diagnostics: [...current.diagnostics, "草稿已变化，保存已阻止；请重新检查。"],
      } : current);
      return;
    }
    const reviewedChanges = changePreview.changes;
    setApplying(true);
    setWarning(null);
    try {
      const result = await backend.applyChanges(
        session.id,
        session.revision,
        changePreview.token,
      );
      let nextSession = { ...session, revision: result.revision, values: { ...session.values } };
      for (const change of reviewedChanges) nextSession.values[change.key] = [...change.after];
      if (activeCandidate && schema) {
        try {
          nextSession = await backend.openConfig(activeCandidate.id);
        } catch (reopenError) {
          setWarning(`配置已保存，但工作区刷新失败；建议重新检查环境。${errorMessage(reopenError)}`);
        }
      }
      setSession(nextSession);
      const nextValues = schema ? valuesForSession(schema.options, nextSession) : { ...draft };
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setNotice(
        result.reloadRequired
          ? "已保存。重新加载 Ghostty 后生效。"
          : "已保存。",
      );
      if (result.warnings.length > 0) {
        setWarning(`配置已保存，但系统无法确认数据已完整写入磁盘：${result.warnings.join("；")}`);
      }
      reviewGuardRef.current.invalidate();
      setReviewOpen(false);
      setChangePreview(null);
      setReviewFailureCode(null);
    } catch (applyError) {
      const applyFailureCode = errorCode(applyError);
      setReviewFailureCode(applyFailureCode);
      if (
        matchesMutationUncertainty(applyFailureCode)
        && activeCandidate
        && schema
      ) {
        try {
          const opened = await backend.openConfig(activeCandidate.id);
          const nextValues = valuesForSession(schema.options, opened);
          const rebasedDraft = { ...nextValues };
          for (const change of reviewedChanges) {
            const option = schema.options.find((item) => item.key === change.key);
            if (option && isGenericallyEditable(option) && change.after.length <= 1) {
              rebasedDraft[change.key] = change.after[0] ?? "";
            }
          }
          setSession(opened);
          setBaseline(nextValues);
          setDraft(rebasedDraft);
          setWarning(
            `已保留外部文件并重新读取配置；兼容草稿仍在，请重新检查。${errorMessage(applyError)}`,
          );
        } catch {
          setSession(null);
          setWarning(
            `无法确认保存结果。为避免覆盖其他修改，编辑已暂停；草稿仍保留，请重新连接工作区。${errorMessage(applyError)}`,
          );
        }
        setReviewOpen(false);
        setChangePreview(null);
        setReviewFailureCode(null);
        return;
      }
      setChangePreview((current) => ({
        token: current?.token ?? "",
        revision: current?.revision ?? session.revision,
        changes: current?.changes ?? reviewedChanges,
        unifiedDiff: current?.unifiedDiff ?? "",
        diagnostics: [...(current?.diagnostics ?? []), errorMessage(applyError)],
        valid: false,
      }));
    } finally {
      setApplying(false);
    }
  };

  const reviewCanRecover = [
    "revision_conflict",
    "ghostty_contract_changed",
    "ghostty_contract_read_only",
    "unknown_session",
    "post_validation_conflict",
    "post_validation_unverified",
  ].includes(reviewFailureCode ?? "");

  const recoverReview = async () => {
    await refreshWorkspace(true);
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

  const secondaryDiagnostics = [
    ...(environment?.warnings ?? []),
    ...(session?.diagnostics ?? []),
    ...(graphError ? [graphError] : []),
  ].filter((message, index, messages) => messages.indexOf(message) === index);

  const selectCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    setSearch("");
  };

  const workspaceFeedback = (
    <div className="workspace-feedback" aria-label="工作区状态">
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void refreshWorkspace(true)} disabled={refreshing}>
            重新检查
          </button>
        </div>
      )}
      {warning && (
        <div className="warning-banner" role="alert">
          <AlertCircle size={16} />
          <span>{warning}</span>
        </div>
      )}
      {refreshing && (
        <div className="info-banner" role="status" aria-live="polite">
          <Settings2 size={15} />
          <span>正在重新读取 Ghostty、设置目录和配置来源…</span>
        </div>
      )}
    </div>
  );

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
          <div className="brand-mark"><Ghost size={20} /></div>
          <div><strong>Ghostty Studio</strong><span>配置编辑器</span></div>
        </div>

        <div className="sidebar-search search-box">
          <Search size={15} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索设置"
            aria-label="搜索设置"
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              aria-label="清除搜索"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          ) : <kbd>⌘K</kbd>}
        </div>

        <nav className="main-nav" aria-label="我的配置">
          <span className="nav-title">配置</span>
          {["常用", "我的配置"].map((name) => {
            const Icon = categoryIcon(name);
            return (
              <button
                type="button"
                key={name}
                className={!search && category === name ? "active" : ""}
                aria-current={!search && category === name ? "page" : undefined}
                onClick={() => selectCategory(name)}
              >
                <Icon size={16} />
                <span>{name}</span>
              </button>
            );
          })}
        </nav>

        <nav className="category-nav" aria-label="设置分类">
          <span className="nav-title">设置</span>
          {categories.map(([name]) => {
            const Icon = categoryIcon(name);
            return (
              <button
                type="button"
                key={name}
                className={!search && category === name ? "active" : ""}
                aria-current={!search && category === name ? "page" : undefined}
                onClick={() => selectCategory(name)}
              >
                <Icon size={16} />
                <span>{name}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={!search && category === "设置参考" ? "active" : ""}
            aria-current={!search && category === "设置参考" ? "page" : undefined}
            onClick={() => selectCategory("设置参考")}
          >
            <BookOpen size={16} />
            <span>设置参考</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="source-context" onClick={() => setSourcePanelOpen(true)}>
            <FileText size={16} />
            <span>
              <strong>{activeCandidate?.label ?? "选择配置"}</strong>
              <small>{isDesktop ? `Ghostty ${environment?.ghostty.version ?? "未连接"}` : "演示模式"}</small>
            </span>
            <ChevronRight size={14} />
          </button>
          <details className="utility-menu">
            <summary><MoreHorizontal size={16} /><span>工具与恢复</span></summary>
            <div className="utility-menu__popover">
              <button type="button" onClick={openHistory}><History size={15} /> 历史与恢复</button>
              <button type="button" onClick={() => setSourcePanelOpen(true)}><Layers3 size={15} /> 配置来源</button>
              <button type="button" onClick={() => setGraphOpen(true)}><FileCog size={15} /> 加载诊断</button>
              {secondaryDiagnostics.length > 0 && (
                <span className="utility-menu__status">
                  {secondaryDiagnostics.length} 条诊断信息
                </span>
              )}
            </div>
          </details>
        </div>
      </aside>

      <main className="workspace">
        <header className="studio-toolbar">
          <div className="studio-toolbar__title">
            <strong>{pageTitle}</strong>
            {activeCandidate && <span>{activeCandidate.label}</span>}
          </div>
          <div className="studio-toolbar__actions">
            {changes.length > 0 && <span className="toolbar-draft">{changes.length} 项未保存</span>}
            <button
              type="button"
              className="toolbar-icon"
              aria-label="重新读取 Ghostty 配置"
              title="重新读取"
              onClick={() => void refreshWorkspace(true)}
              disabled={refreshing || applying}
            >
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            </button>
            <span className={`connection-state connection-state--${workspaceSummary.state}`}>
              <i />{isDesktop ? "已连接" : "演示"}
            </span>
          </div>
        </header>

        {!session ? (
          <div className="setup-container" aria-busy={refreshing}>
            <div className="setup-container__feedback">{workspaceFeedback}</div>
            <SetupPage
              environment={environment}
              refreshing={refreshing}
              pendingChanges={changes.length}
              onChooseSource={() => setSourcePanelOpen(true)}
              onRefresh={() => void refreshWorkspace(true)}
            />
          </div>
        ) : (
          <div
            ref={contentGridRef}
            className={`content-grid ${showPreview ? "content-grid--with-preview" : "content-grid--settings-only"}`}
            aria-busy={refreshing}
          >
            <section ref={settingsPaneRef} className="settings-pane">
              <div className="settings-content">
                <div className="section-heading">
                  <div>
                    <h1>{pageTitle}</h1>
                    <p>{pageDescription}</p>
                  </div>
                </div>

              {workspaceFeedback}

                {compatibilityChange && (
                  <div className="context-callout context-callout--upgrade">
                    <Settings2 size={16} />
                    <span>
                      <strong>Ghostty 设置已更新</strong>
                      {compatibilityChange.changedKeys.length + compatibilityChange.removedKeys.length > 0
                        ? `${compatibilityChange.changedKeys.length + compatibilityChange.removedKeys.length} 项设置需要重新确认。`
                        : "现有设置仍可继续使用。"}
                    </span>
                    <button type="button" onClick={() => setCompatibilityChange(null)}>知道了</button>
                  </div>
                )}

                {showPreview && (
                  <details className="inline-preview">
                    <summary>显示外观预览</summary>
                    <TerminalPreview values={previewMode === "draft" ? previewValues : savedPreviewValues} />
                  </details>
                )}

                <div className="settings-groups">
                  {optionGroups.map(([groupName, options]) => (
                    <section className="settings-group" key={groupName || category}>
                      {groupName && <h2>{groupName}</h2>}
                      <div className="settings-list">
                        {options.map((option) => {
                          const value = draft[option.key] ?? "";
                          const configuredInEditingLayer = (session.values[option.key]?.length ?? 0) > 0;
                          return (
                            <SettingRow
                              key={option.key}
                              option={option}
                              value={value}
                              baselineValue={baseline[option.key] ?? ""}
                              configuredInEditingLayer={configuredInEditingLayer}
                              effectiveValueKnown={configGraph?.semanticsKnown ?? false}
                              sourceLabel={activeCandidate?.label ?? "当前配置"}
                              onValueChange={updateDraftValue}
                              onReset={resetDraftValue}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                {visibleOptions.length === 0 && (
                  <div className="empty-state">
                    <Search size={22} />
                    <strong>{search ? "没有找到相关设置" : category === "我的配置" ? "当前文件还没有显式设置" : "设置目录暂时不可用"}</strong>
                    <span>{search ? "试试功能、中文名称或 Ghostty 配置名。" : "从常用设置开始，保存后会出现在这里。"}</span>
                    {search && <button type="button" className="button button--secondary" onClick={() => setSearch("")}>清除搜索</button>}
                  </div>
                )}
              </div>
            </section>

            {showPreview && (
              <aside className="preview-pane">
                <div className="preview-heading">
                  <div><strong>外观预览</strong><span>模拟效果</span></div>
                  <div className="preview-segment" aria-label="预览版本">
                    <button
                      type="button"
                      className={previewMode === "saved" ? "active" : ""}
                      onClick={() => setPreviewMode("saved")}
                    >
                      已保存
                    </button>
                    <button
                      type="button"
                      className={previewMode === "draft" ? "active" : ""}
                      onClick={() => setPreviewMode("draft")}
                    >
                      当前草稿
                    </button>
                  </div>
                </div>
                <TerminalPreview values={previewMode === "draft" ? previewValues : savedPreviewValues} />
                <p className="preview-note">用于比较颜色、字体、间距和光标。最终效果以 Ghostty 为准。</p>
              </aside>
            )}
          </div>
        )}

        {session && changes.length > 0 && (
          <section className="draft-dock" aria-label="未保存的修改">
            <div role="status" aria-live="polite">
              <span className="draft-dot" />
              <strong>{changes.length} 项修改尚未保存</strong>
              <small>仍只保留在本次打开的应用中</small>
            </div>
            <div className="draft-dock__actions">
              <button type="button" className="button button--secondary" onClick={resetAllDraft} disabled={applying}>
                <RotateCcw size={14} /> 放弃修改
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void openReview()}
                disabled={reviewLoading || applying}
              >
                {reviewLoading ? "正在检查…" : "检查并保存"}
                <kbd>⌘S</kbd>
              </button>
            </div>
          </section>
        )}

        {notice && (
          <div className="save-toast">
            <CheckCircle2 size={17} />
            <span role="status" aria-live="polite">{notice}</span>
            {discardedDraft && (
              <button type="button" className="save-toast__action" onClick={undoDiscardedDraft}>
                撤销
              </button>
            )}
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => {
                setNotice(null);
                setDiscardedDraft(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </main>

      {reviewOpen && (
        <ReviewPanel
          changes={changes}
          preview={changePreview}
          loading={reviewLoading}
          applying={applying}
          canRecover={reviewCanRecover}
          readOnly={session?.readOnly ?? true}
          onClose={closeReview}
          onApply={applyReviewedChanges}
          onRetry={() => void openReview()}
          onRecover={() => void recoverReview()}
        />
      )}
      {graphOpen && <ConfigGraphPanel graph={configGraph} onClose={() => setGraphOpen(false)} />}
      {sourcePanelOpen && (
        <ConfigSourcePanel
          environment={environment}
          activeCandidate={activeCandidate}
          pendingChanges={changes.length}
          switchingCandidateId={switchingCandidateId}
          error={sourceError}
          onClose={() => setSourcePanelOpen(false)}
          onOpenGraph={() => {
            setSourcePanelOpen(false);
            setGraphOpen(true);
          }}
          onSelect={switchCandidate}
          onCreate={createCandidate}
        />
      )}
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
