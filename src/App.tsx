import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileCog,
  FileText,
  Ghost,
  Globe2,
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
import { ReferenceSettingRow } from "./components/ReferenceSettingRow";
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
import { textForLocale, useI18n, type AppLocale, type LanguagePreference } from "./i18n";
import { copyForSetting } from "./settingCopy";
import {
  categoryId,
  categoryLabel,
  chooseStartupCandidate,
  chooseWorkspaceCandidate,
  COMMON_SETTING_KEYS,
  configuredSettingMap,
  editableCategoryCounts,
  isCommonSetting,
  PREVIEW_SETTING_KEYS,
  withConfiguredReferences,
} from "./workspaceModel";
import type {
  ApplyResult,
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

const viewPreferenceIds: Record<string, string> = {
  "常用": "common",
  "我的配置": "configured",
  "设置参考": "catalog",
};

function normalizeViewPreference(value: string | null): string {
  if (!value) return "common";
  return viewPreferenceIds[value] ?? categoryId(value);
}

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

function savedNotice(locale: AppLocale, activation: ApplyResult["activation"], target?: string): string {
  const saved = target
    ? textForLocale(locale, `已保存到 ${target}。`, `Saved to ${target}. `)
    : textForLocale(locale, "已保存。", "Saved. ");
  if (activation === "restart") {
    return `${saved}${textForLocale(locale, "重启 Ghostty 后生效。", "Restart Ghostty to apply the changes.")}`;
  }
  if (activation === "reload-new-terminal") {
    return `${saved}${textForLocale(locale, "重新载入后，新终端会使用这些设置。", "Reload Ghostty; new terminals will use these settings.")}`;
  }
  if (activation === "reload") {
    return `${saved}${textForLocale(locale, "重新载入 Ghostty 后生效。", "Reload Ghostty to apply the changes.")}`;
  }
  return `${saved}${textForLocale(locale, "请在 Ghostty 中确认最终效果。", "Check the final result in Ghostty.")}`;
}

function errorMessage(locale: AppLocale, error: unknown): string {
  const friendlyMessages: Record<string, [string, string]> = {
    unknown_session: ["配置会话已过期，请重新打开应用。", "This configuration session has expired. Reopen the app to continue."],
    invalid_candidate: ["无法确认这个配置位置，请重新检查。", "This configuration location could not be verified. Check again."],
    unknown_candidate: ["这个配置位置已发生变化，请重新检查。", "This configuration location has changed. Check again."],
    state_poisoned: ["本地工作区暂时不可用，请重新启动应用。", "The local workspace is temporarily unavailable. Restart the app."],
    schema_not_loaded: ["可用设置尚未准备好，请重新检查。", "The available settings are not ready yet. Check again."],
    revision_conflict: ["配置已被其他应用修改。重新读取后再保存。", "Another app changed this configuration. Reload it before saving."],
    read_only_session: ["这份配置只能查看。请选择可写的位置。", "This configuration is read-only. Choose a writable location."],
    unknown_stage: ["检查结果已过期，请重新检查更改。", "This review has expired. Check the changes again."],
    stage_mismatch: ["检查结果与当前草稿不一致，请重新检查。", "The review no longer matches the draft. Check the changes again."],
    validation_failed: ["Ghostty 无法读取这份草稿，请按提示调整。", "Ghostty could not read this draft. Review the details and adjust it."],
    validation_failed_after_confirmation: ["Ghostty 无法读取这份草稿，文件没有保存。", "Ghostty could not read this draft, so nothing was saved."],
    setting_requires_specialized_editor: ["这项设置需要专用编辑方式，原配置没有改变。", "This setting needs a dedicated editor. The original configuration was preserved."],
    complex_setting_requires_editor: ["这项设置包含多项内容，需要专用编辑方式。", "This setting contains multiple values and needs a dedicated editor."],
    duplicate_setting_requires_editor: ["这项设置在文件中出现多次，请先在配置文件中整理。", "This setting appears more than once. Organize it in the configuration file first."],
    ghostty_contract_changed: ["Ghostty 已更新。设置已重新读取，请再次检查草稿。", "Ghostty was updated. Settings were reloaded; review the draft again."],
    ghostty_contract_read_only: ["这个 Ghostty 版本尚未适配，设置暂时只能查看。", "This Ghostty version is not supported for editing yet. Settings remain view-only."],
    ghostty_unavailable: ["没有找到 Ghostty，暂时无法保存。", "Ghostty was not found, so changes cannot be saved yet."],
    mutation_in_progress: ["另一项配置操作正在进行，请稍后再试。", "Another configuration task is in progress. Try again shortly."],
    native_confirmation_failed: ["无法打开系统确认窗口。", "The system confirmation dialog could not be opened."],
    native_confirmation_cancelled: ["操作已取消。", "The action was cancelled."],
    snapshot_requires_specialized_restore: ["这个恢复点包含当前版本无法自动还原的设置。", "This restore point contains settings this version cannot restore safely."],
    missing_config: ["配置文件不存在，请重新检查位置。", "The configuration file no longer exists. Check its location."],
    config_already_exists: ["目标位置已经有配置文件。为避免覆盖，请重新检查。", "A configuration file now exists at that location. Check again to avoid overwriting it."],
    existing_config_prevents_creation: ["已经存在默认配置，请选择它或手动管理其他位置。", "A default configuration already exists. Choose it or manage other locations manually."],
    config_creation_not_allowed: ["这个位置不满足安全创建条件，请手动创建后再检查。", "This location is not eligible for safe creation. Create it manually, then check again."],
    creation_outside_home: ["只能在用户目录内的 Ghostty 默认位置安全创建配置。", "Safe creation is limited to Ghostty's default locations in your home folder."],
    creation_outside_approved_root: ["只能在用户目录内的 Ghostty 默认位置安全创建配置。", "Safe creation is limited to Ghostty's default locations in your home folder."],
    relative_xdg_config_home: ["XDG_CONFIG_HOME 不是绝对路径，请修正或手动创建配置。", "XDG_CONFIG_HOME is not an absolute path. Fix it or create the configuration manually."],
    non_utf8_config_root: ["无法安全识别配置目录，自动创建已停用。", "The configuration folder could not be identified safely, so automatic creation is unavailable."],
    home_unavailable: ["无法确认用户目录，自动创建已停止。", "Your home folder could not be verified, so automatic creation was stopped."],
    invalid_creation_root: ["配置目录不满足安全要求，请手动创建后再检查。", "The configuration folder does not meet the safety requirements. Create it manually, then check again."],
    invalid_creation_parent: ["配置路径包含无法安全使用的目录，请选择其他位置。", "The configuration path contains a folder that cannot be used safely. Choose another location."],
    invalid_target: ["这个配置位置不满足安全创建要求。", "This configuration location does not meet the safety requirements."],
    candidate_changed: ["确认期间配置位置发生了变化。没有创建文件，请重新检查。", "The configuration location changed during confirmation. Nothing was created; check again."],
    baseline_validation_failed: ["Ghostty 的默认配置未通过验证，因此没有创建文件。", "Ghostty's default configuration did not pass validation, so no file was created."],
    config_creation_not_supported: ["当前平台不支持安全自动创建，请手动创建后再检查。", "Safe automatic creation is unavailable on this platform. Create the file manually, then check again."],
    config_creation_failed: ["无法安全创建配置文件，已有内容没有改变。", "The configuration file could not be created safely. Existing content was not changed."],
    post_creation_validation_failed: ["新配置未通过 Ghostty 验证。空文件已保留，请检查后手动处理。", "The new configuration did not pass Ghostty validation. The empty file was kept for manual review."],
    post_creation_conflict: ["新配置随即被其他应用修改。较新的文件已保留，请重新检查。", "Another app changed the new configuration. The newer file was preserved; check again."],
    post_creation_unverified: ["配置可能已经创建，但无法确认最终状态。请重新检查。", "The configuration may have been created, but its final state could not be verified. Check again."],
    post_creation_rollback_failed: ["无法确认新配置是否已安全撤回。请先重新检查，不要重复创建。", "The new configuration could not be confirmed as reverted. Check again before retrying."],
    creation_rollback_failed: ["无法确认空配置是否已撤回。请重新检查。", "The empty configuration could not be confirmed as reverted. Check again."],
    config_too_large: ["配置文件超过安全读取上限，应用不会继续处理。", "The configuration exceeds the safe read limit and will not be processed."],
    invalid_encoding: ["配置文件不是有效的 UTF-8，应用不会改写它。", "The configuration is not valid UTF-8 and will not be rewritten."],
    io_error: ["本地文件操作没有完成。请重新检查实际状态。", "The local file operation did not complete. Check the current state."],
    ghostty_schema_failed: ["无法读取 Ghostty 的可用设置，请检查安装。", "Ghostty's available settings could not be read. Check the installation."],
    ghostty_spawn_failed: ["无法启动 Ghostty 验证，请检查安装。", "Ghostty validation could not start. Check the installation."],
    ghostty_pipe_failed: ["无法安全读取 Ghostty 的验证结果。", "Ghostty's validation result could not be read safely."],
    ghostty_pipe_timeout: ["读取 Ghostty 验证结果超时，操作已停止。", "Reading Ghostty's validation result timed out. The operation was stopped."],
    ghostty_timeout: ["Ghostty 验证超时，操作已停止。", "Ghostty validation timed out. The operation was stopped."],
    ghostty_output_too_large: ["Ghostty 返回的验证结果过大，操作已停止。", "Ghostty returned too much validation output. The operation was stopped."],
    no_effective_changes: ["草稿没有改变这份配置。", "The draft does not change this configuration."],
    post_validation_conflict: ["验证期间配置被其他应用修改。外部修改已保留，请重新检查。", "Another app changed the configuration during validation. Its changes were preserved; check again."],
    post_validation_unverified: ["写入后的文件状态无法确认，编辑已暂停。请重新读取配置。", "The file could not be verified after writing, so editing was paused. Reload the configuration."],
    invalid_setting_value: ["这个值不符合设置格式。", "This value does not match the setting's format."],
    value_out_of_range: ["这个数值超出了可用范围。", "This value is outside the allowed range."],
    invalid_locale: ["界面语言无效，请重新选择。", "The interface language is invalid. Choose it again."],
  };
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && friendlyMessages[code]) {
      const message = friendlyMessages[code];
      return textForLocale(locale, message[0], message[1]);
    }
  }
  const knownBrowserMessages: Record<string, [string, string]> = {
    "浏览器演示模式不会创建本地配置文件": ["试用模式不会创建本地配置文件。", "Try mode does not create local configuration files."],
    "浏览器演示模式禁止写入本地配置": ["试用模式不会写入本地配置。", "Try mode does not write local configuration files."],
    "浏览器演示模式只展示示例快照，禁止恢复本地配置": ["试用模式只能查看示例恢复点。", "Try mode only shows sample restore points."],
  };
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : null;
  if (rawMessage && knownBrowserMessages[rawMessage]) {
    const message = knownBrowserMessages[rawMessage];
    return textForLocale(locale, message[0], message[1]);
  }
  return textForLocale(
    locale,
    "操作没有完成。请重新检查；你的配置和草稿不会被静默覆盖。",
    "The action did not finish. Check again; your configuration and draft will not be overwritten silently.",
  );
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

async function loadWorkspaceResources(locale: AppLocale) {
  const [environmentResult, schemaResult, graphResult] = await Promise.allSettled([
    backend.probeEnvironment(),
    backend.loadRuntimeSchema(),
    backend.loadConfigGraph(),
  ]);
  const environmentError = environmentResult.status === "rejected"
    ? `${textForLocale(locale, "环境检查失败：", "Environment check failed: ")}${errorMessage(locale, environmentResult.reason)}`
    : null;
  const schemaError = schemaResult.status === "rejected"
    ? `${textForLocale(locale, "设置读取失败：", "Settings could not be loaded: ")}${errorMessage(locale, schemaResult.reason)}`
    : null;
  const graphError = graphResult.status === "rejected"
    ? `${textForLocale(locale, "配置来源读取失败：", "Configuration sources could not be loaded: ")}${errorMessage(locale, graphResult.reason)}`
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
  if (category === "common") return Star;
  if (category === "configured") return FileText;
  if (category === "catalog") return BookOpen;
  if (category === "appearance") return Sparkles;
  if (category === "privacy-security") return ShieldCheck;
  if (category === "window") return PanelLeft;
  if (category === "advanced") return Settings2;
  return SlidersHorizontal;
}

export default function App() {
  const { locale, preference, setPreference, text } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentGridRef = useRef<HTMLDivElement>(null);
  const settingsPaneRef = useRef<HTMLElement>(null);
  const utilityMenuRef = useRef<HTMLDetailsElement>(null);
  const previousLocaleRef = useRef(locale);
  const pendingFocusKeyRef = useRef<string | null>(null);
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
  const [category, setCategory] = useState(() => normalizeViewPreference(readPreference(LAST_CATEGORY_KEY)));
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
    if (previousLocaleRef.current === locale) return;
    previousLocaleRef.current = locale;

    if (discardedDraft) {
      const discardedChangeCount = Object.keys(discardedDraft)
        .filter((key) => discardedDraft[key] !== baseline[key]).length;
      setNotice(text(
        "已放弃 {count} 项修改。",
        "Discarded {count} {noun}.",
        {
          count: discardedChangeCount,
          noun: discardedChangeCount === 1 ? "change" : "changes",
        },
      ));
    } else {
      setNotice(null);
    }
    setHistoryNotice(null);
  }, [baseline, discardedDraft, locale, text]);

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

  useEffect(() => {
    const closeUtilityMenu = (event: PointerEvent | KeyboardEvent) => {
      const menu = utilityMenuRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        menu.removeAttribute("open");
        menu.querySelector<HTMLElement>("summary")?.focus();
        return;
      }
      if (event instanceof PointerEvent && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", closeUtilityMenu, true);
    document.addEventListener("keydown", closeUtilityMenu);
    return () => {
      document.removeEventListener("pointerdown", closeUtilityMenu, true);
      document.removeEventListener("keydown", closeUtilityMenu);
    };
  }, []);

  useLayoutEffect(() => {
    if (contentGridRef.current) contentGridRef.current.scrollTop = 0;
    if (settingsPaneRef.current) settingsPaneRef.current.scrollTop = 0;
  }, [category, search]);

  useEffect(() => {
    let cancelled = false;
    loadWorkspaceResources(locale)
      .then(async (resources) => {
        if (cancelled) return;
        setEnvironment(resources.environment);
        setSchema(resources.schema);
        setConfigGraph(resources.graph);
        setGraphError(resources.graph ? null : resources.graphError ?? text("配置来源暂时不可用。", "Configuration sources are temporarily unavailable."));
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
            if (!cancelled) setError(errorMessage(locale, openError));
          }
        }
        if (!cancelled) {
          if (resources.errors.length > 0) setWarning(resources.errors.join("；"));
          setBaseline({ ...values });
          setDraft({ ...values });
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(locale, nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // Locale changes must not reopen the workspace or replace an in-progress draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const counts = editableCategoryCounts(schema?.options ?? []);
    const preferredOrder = [
      "appearance",
      "font",
      "window",
      "cursor",
      "mouse-scroll",
      "keyboard",
      "privacy-security",
      "quick-terminal",
      "shell-environment",
      "macos",
      "linux-gtk",
      "advanced",
    ];
    return counts.sort(([a], [b]) => {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) {
        if (aIndex < 0) return 1;
        if (bIndex < 0) return -1;
        return aIndex - bIndex;
      }
      return categoryLabel(locale, a).localeCompare(categoryLabel(locale, b), locale);
    });
  }, [locale, schema]);

  const configuredSettings = useMemo(
    () => configuredSettingMap(session?.configuredSettings ?? []),
    [session],
  );

  const workspaceOptions = useMemo(
    () => withConfiguredReferences(schema?.options ?? [], session?.configuredSettings ?? []),
    [schema, session],
  );

  useEffect(() => {
    if (!schema) return;
    const validCategories = new Set([
      "common",
      "configured",
      "catalog",
      ...categories.map(([name]) => name),
    ]);
    if (!validCategories.has(category)) setCategory("common");
  }, [category, categories, schema]);

  useEffect(() => {
    if (category) writePreference(LAST_CATEGORY_KEY, category);
  }, [category]);

  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const options = workspaceOptions.filter((option) => {
      const copy = copyForSetting(locale, option.key, option.description);
      const alternateLocale = locale === "zh-CN" ? "en" : "zh-CN";
      const alternateCopy = copyForSetting(alternateLocale, option.key, option.description);
      const searchable = `${option.key} ${copy.label} ${copy.summary ?? ""} ${alternateCopy.label} ${alternateCopy.summary ?? ""} ${option.description} ${categoryLabel(locale, option.category)}`.toLocaleLowerCase();
      if (needle) return searchable.includes(needle);
      if (category === "common") return isCommonSetting(option);
      if (category === "configured") return configuredSettings.has(option.key);
      if (category === "catalog") return true;
      return categoryId(option.category) === category && isGenericallyEditable(option);
    });
    if (!needle && category === "common") {
      return options.sort((a, b) => (
        COMMON_SETTING_KEYS.indexOf(a.key as typeof COMMON_SETTING_KEYS[number])
        - COMMON_SETTING_KEYS.indexOf(b.key as typeof COMMON_SETTING_KEYS[number])
      ));
    }
    return options;
  }, [workspaceOptions, category, search, configuredSettings, locale]);

  useLayoutEffect(() => {
    const key = pendingFocusKeyRef.current;
    if (!key) return;
    const row = document.getElementById(`setting-${key}`);
    if (!row) return;
    pendingFocusKeyRef.current = null;
    row.scrollIntoView?.({ block: "center" });
    row.querySelector<HTMLElement>(
      ".setting-input button:not([disabled]), .setting-input input:not([disabled]), .setting-input select:not([disabled])",
    )?.focus();
  }, [category, search, visibleOptions]);

  const optionGroups = useMemo(() => {
    const grouped = new Map<string, RuntimeOption[]>();
    for (const option of visibleOptions) {
      const group = search
        ? isGenericallyEditable(option) ? "search-editable" : "search-reference"
        : category === "configured"
          ? isGenericallyEditable(option) ? "configured-editable" : "configured-reference"
          : category === "common" || category === "catalog"
            ? categoryId(option.category)
            : "";
      const items = grouped.get(group) ?? [];
      items.push(option);
      grouped.set(group, items);
    }
    const groups = [...grouped.entries()];
    if (search) {
      const order = ["search-editable", "search-reference"];
      groups.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
    }
    return groups;
  }, [category, search, visibleOptions]);

  const referenceCountForPage = useMemo(() => {
    if (search || category === "catalog" || category === "configured") return 0;
    return workspaceOptions.filter((option) => (
      categoryId(option.category) === category && !isGenericallyEditable(option)
    )).length;
  }, [category, search, workspaceOptions]);

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
    locale,
  ), [environment, schema, session, configGraph, locale]);

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
    return category === "common"
      || category === "appearance"
      || category === "font"
      || category === "window"
      || category === "cursor";
  }, [category, search, visibleOptions]);

  const pageTitle = search
    ? text("搜索", "Search")
    : category === "configured"
      ? text("已设置", "Configured")
      : category === "catalog"
        ? text("全部设置", "All settings")
        : category === "common"
          ? text("常用", "Essentials")
          : categoryLabel(locale, category);
  const pageDescription = search
    ? text("找到 {count} 项设置，可调整项排在前面。", "{count} {noun}, with editable settings first.", {
        count: visibleOptions.length,
        noun: visibleOptions.length === 1 ? "result" : "results",
      })
    : category === "common"
      ? text("从最常用的设置开始。", "Start with the settings people use most.")
      : category === "configured"
        ? text("这份文件中已经设置的项目。", "Settings already present in this file.")
        : category === "catalog"
          ? text("浏览当前 Ghostty 版本提供的全部设置。", "Browse every setting available in this version of Ghostty.")
          : text("调整 Ghostty 的{category}体验。", "Tune Ghostty's {category} settings.", {
              category: categoryLabel(locale, category).toLocaleLowerCase(locale),
            });

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
    setNotice(text(
      "已放弃 {count} 项修改。",
      "Discarded {count} {noun}.",
      { count: changes.length, noun: changes.length === 1 ? "change" : "changes" },
    ));
    setReviewOpen(false);
    setChangePreview(null);
    setReviewFailureCode(null);
    setDraft({ ...baseline });
  }, [baseline, changes.length, draft, text]);

  const undoDiscardedDraft = useCallback(() => {
    if (!discardedDraft) return;
    reviewGuardRef.current.invalidate();
    setDraft(discardedDraft);
    setDiscardedDraft(null);
    setNotice(text("已恢复刚才的草稿。", "The discarded draft was restored."));
  }, [discardedDraft, text]);

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
      const resources = await loadWorkspaceResources(locale);
      setEnvironment(resources.environment);
      setSchema(resources.schema);
      setConfigGraph(resources.graph);
      setGraphError(resources.graph ? null : resources.graphError ?? text("配置来源暂时不可用。", "Configuration sources are temporarily unavailable."));

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
          ? text("可用设置暂时无法读取", "available settings could not be loaded")
          : text("原配置位置已经变化", "the original configuration location changed");
        setWarning([
          text(
            "{reason}；{count} 项草稿仍保留在本次会话中。重新连接原配置，或选择其他配置后再继续。",
            "Because {reason}, {count} draft {noun} remain in this session. Reconnect the original configuration or choose another one to continue.",
            { reason, count: capturedChanges.length, noun: capturedChanges.length === 1 ? "change" : "changes" },
          ),
          ...resources.errors,
        ].join(text("；", "; ")));
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
              text(
                "暂时无法重新打开 {target}；{count} 项草稿仍保留在本次会话中。{error}",
                "Could not reopen {target}. {count} draft {noun} remain in this session. {error}",
                {
                  target: candidate.label,
                  count: capturedChanges.length,
                  noun: capturedChanges.length === 1 ? "change" : "changes",
                  error: errorMessage(locale, openError),
                },
              ),
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
          ? text(
              "已重新读取工作区，并保留 {count} 项草稿。保存前请再次检查。",
              "The workspace was reloaded and {count} draft {noun} were preserved. Review again before saving.",
              { count: preservedCount, noun: preservedCount === 1 ? "change" : "changes" },
            )
          : text("已重新检查 Ghostty、可用设置和配置来源。", "Ghostty, available settings, and configuration sources were checked again."),
      );
      setSourceError(null);
      if (resources.errors.length > 0) setWarning(resources.errors.join(text("；", "; ")));
      return true;
    } catch (refreshError) {
      setError(text(
        "重新检查失败：{error}",
        "Check failed: {error}",
        { error: errorMessage(locale, refreshError) },
      ));
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
      setNotice(text(
        "已切换到 {target}；尚未写入任何内容。",
        "Switched to {target}. Nothing has been written.",
        { target: candidate.label },
      ));
      setWarning(null);
      setError(null);
      return true;
    } catch (switchError) {
      setSourceError(errorMessage(locale, switchError));
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
      const opened = await backend.createConfig(candidate.id, locale);
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
        setGraphError(text(
          "配置已创建，但来源信息刷新失败：{error}",
          "The configuration was created, but source details could not be refreshed: {error}",
          { error: errorMessage(locale, graphResult.reason) },
        ));
      }
      setSession(opened);
      writePreference(PREFERRED_CANDIDATE_KEY, opened.candidateId);
      const nextValues = valuesForSession(schema.options, opened);
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setChangePreview(null);
      setReviewOpen(false);
      setNotice(text(
        "已创建并打开 {target}；尚未写入任何设置。",
        "Created and opened {target}. No settings have been written yet.",
        { target: candidate.label },
      ));
      const creationWarnings = opened.diagnostics.filter((diagnostic) => (
        diagnostic.includes("fsync") || diagnostic.includes("耐久性")
      ));
      if (environmentResult.status === "rejected") {
        creationWarnings.push(text(
          "配置已创建，但工作区刷新失败：{error}",
          "The configuration was created, but the workspace could not be refreshed: {error}",
          { error: errorMessage(locale, environmentResult.reason) },
        ));
      }
      setWarning(creationWarnings.length > 0 ? creationWarnings.join(text("；", "; ")) : null);
      setError(null);
      return true;
    } catch (createError) {
      const code = errorCode(createError);
      let message = errorMessage(locale, createError);
      if (code !== "native_confirmation_cancelled") {
        const [environmentResult, schemaResult, graphResult] = await Promise.allSettled([
          backend.probeEnvironment(),
          backend.loadRuntimeSchema(),
          backend.loadConfigGraph(),
        ]);
        if (environmentResult.status === "fulfilled") {
          setEnvironment(environmentResult.value);
          message += text(" 已重新读取实际配置状态；草稿仍保留。", " The current configuration was reloaded and the draft was preserved.");
        } else {
          message += text(
            " 工作区重新检查失败：{error}",
            " The workspace could not be checked again: {error}",
            { error: errorMessage(locale, environmentResult.reason) },
          );
        }
        if (schemaResult.status === "fulfilled" && schemaResult.value.schemaHash !== schema?.schemaHash) {
          const defaults = initialValues(schemaResult.value.options);
          setSchema(schemaResult.value);
          setBaseline((current) => ({ ...defaults, ...current }));
          setDraft((current) => ({ ...defaults, ...current }));
          message += text(" Ghostty 的可用设置也有变化，保存前请再次检查。", " Ghostty's available settings also changed. Review again before saving.");
        }
        if (graphResult.status === "fulfilled") {
          setConfigGraph(graphResult.value);
          setGraphError(null);
        } else {
          setGraphError(text(
            "配置来源刷新失败：{error}",
            "Configuration sources could not be refreshed: {error}",
            { error: errorMessage(locale, graphResult.reason) },
          ));
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
      if (!session) throw new Error(text("尚未打开配置会话", "No configuration session is open"));
      const preview = await backend.stageChanges(session.id, session.revision, reviewedChanges);
      if (!reviewGuardRef.current.isCurrent(requestId)) return;
      if (!changeSetsEqual(reviewedChanges, changesRef.current)) {
        setReviewFailureCode("draft_changed");
        setChangePreview({
          token: "",
          revision: session.revision,
          changes: reviewedChanges,
          unifiedDiff: "",
          diagnostics: [text("检查期间草稿发生了变化，请重新检查。", "The draft changed during review. Check it again.")],
          valid: false,
          activation: "unknown",
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
        diagnostics: [errorMessage(locale, stageError)],
        valid: false,
        activation: "unknown",
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
        diagnostics: [...current.diagnostics, text("草稿已经变化，保存已停止。请重新检查。", "The draft changed, so saving was stopped. Check it again.")],
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
        locale,
      );
      let nextSession = {
        ...session,
        revision: result.revision,
        values: { ...session.values },
        configuredSettings: [...session.configuredSettings],
      };
      for (const change of reviewedChanges) {
        nextSession.values[change.key] = [...change.after];
        nextSession.configuredSettings = nextSession.configuredSettings
          .filter((item) => item.key !== change.key);
        if (change.after.length > 0) {
          nextSession.configuredSettings.push({
            key: change.key,
            occurrenceCount: change.after.length,
            valueExposure: "available",
          });
        }
      }
      if (activeCandidate && schema) {
        try {
          nextSession = await backend.openConfig(activeCandidate.id);
        } catch (reopenError) {
          setWarning(text(
            "配置已保存，但工作区刷新失败。请重新检查。{error}",
            "The configuration was saved, but the workspace could not be refreshed. Check again. {error}",
            { error: errorMessage(locale, reopenError) },
          ));
        }
      }
      setSession(nextSession);
      const nextValues = schema ? valuesForSession(schema.options, nextSession) : { ...draft };
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setNotice(savedNotice(locale, result.activation, activeCandidate?.label));
      if (result.warnings.length > 0) {
        setWarning(text(
          "配置已保存，但系统无法确认数据已完整写入磁盘。请重新检查。",
          "The configuration was saved, but a complete disk write could not be confirmed. Check again.",
        ));
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
            text(
              "已保留外部修改并重新读取配置；草稿仍在，请重新检查。{error}",
              "External changes were preserved and the configuration was reloaded. Your draft remains; check it again. {error}",
              { error: errorMessage(locale, applyError) },
            ),
          );
        } catch {
          setSession(null);
          setWarning(
            text(
              "无法确认保存结果。为避免覆盖其他修改，编辑已暂停；草稿仍保留。{error}",
              "The save result could not be verified. Editing was paused to protect other changes, and your draft remains. {error}",
              { error: errorMessage(locale, applyError) },
            ),
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
        diagnostics: [...(current?.diagnostics ?? []), errorMessage(locale, applyError)],
        valid: false,
        activation: current?.activation ?? "unknown",
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
      if (!targetSession) throw new Error(text("尚未打开配置，无法读取恢复点", "No configuration is open, so restore points cannot be loaded"));
      const nextSnapshots = await backend.listSnapshots(targetSession.id);
      setSnapshots(nextSnapshots);
    } catch (snapshotError) {
      setHistoryError(text(
        "读取恢复点失败：{error}",
        "Restore points could not be loaded: {error}",
        { error: errorMessage(locale, snapshotError) },
      ));
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
      setHistoryError(text("当前配置不可用，请重新打开应用后再恢复。", "The current configuration is unavailable. Reopen the app before restoring."));
      return false;
    }
    if (!isDesktop || session.readOnly) {
      setHistoryError(text("当前配置只能查看，无法恢复。", "This configuration is read-only and cannot be restored."));
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
        locale,
      );

      setHistoryNotice(text("恢复完成；恢复前的配置也已保留。", "Restore complete. The previous configuration was preserved too."));
      setNotice(savedNotice(locale, result.activation));
      if (result.warnings.length > 0) {
        setWarning(text(
          "恢复已完成，但系统无法确认数据已完整写入磁盘。请重新检查。",
          "The restore completed, but a complete disk write could not be confirmed. Check again.",
        ));
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
          setHistoryError(text(
            "恢复已完成，但恢复点列表刷新失败：{error}",
            "The restore completed, but restore points could not be refreshed: {error}",
            { error: errorMessage(locale, listError) },
          ));
        }
      } catch (refreshError) {
        setSession(null);
        setHistoryError(
          text(
            "恢复已完成，但工作区刷新失败。编辑已暂停，请重新打开应用。{error}",
            "The restore completed, but the workspace could not be refreshed. Editing was paused; reopen the app. {error}",
            { error: errorMessage(locale, refreshError) },
          ),
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
      setHistoryError(text(
        "无法确认恢复结果，已重新读取配置：{error}",
        "The restore result could not be verified, so the configuration was reloaded: {error}",
        { error: errorMessage(locale, restoreError) },
      ));
      return false;
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const secondaryDiagnostics = [
    ...(environment?.warnings ?? []),
    ...(schema?.diagnostics ?? []),
    ...(session?.diagnostics ?? []),
    ...(graphError ? [graphError] : []),
  ].filter((message, index, messages) => messages.indexOf(message) === index);

  const groupLabel = (group: string) => {
    if (group === "search-editable") return text("可直接调整", "Editable here");
    if (group === "search-reference") return text("设置参考", "Reference settings");
    if (group === "configured-editable") return text("可在这里调整", "Editable here");
    if (group === "configured-reference") return text("在配置文件中管理", "Managed in the config file");
    return categoryLabel(locale, group);
  };

  const platform = environment?.platform.toLocaleLowerCase() ?? "";
  const primaryModifier = platform.includes("mac") ? "⌘" : "Ctrl";

  const selectCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    setSearch("");
  };

  const adjustReferencedSetting = (option: RuntimeOption) => {
    pendingFocusKeyRef.current = option.key;
    setSearch("");
    setCategory(categoryId(option.category));
  };

  const workspaceFeedback = (
    <div className="workspace-feedback" aria-label={text("工作区状态", "Workspace status")}>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void refreshWorkspace(true)} disabled={refreshing}>
            {text("重新检查", "Check again")}
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
          <span>{text("正在重新读取 Ghostty、可用设置和配置来源…", "Reloading Ghostty, available settings, and configuration sources…")}</span>
        </div>
      )}
      {!refreshing && session?.readOnly && isDesktop && (
        <div className="info-banner" role="status">
          <FileText size={15} />
          <span>{text("这份配置只能查看。请选择其他写入位置。", "This configuration is read-only. Choose another write location.")}</span>
          <button type="button" onClick={() => setSourcePanelOpen(true)}>{text("切换位置", "Choose location")}</button>
        </div>
      )}
      {!refreshing && category === "configured" && (session?.unrecognizedSettingCount ?? 0) > 0 && (
        <div className="info-banner" role="status">
          <FileText size={15} />
          <span>{text(
            "这份文件还有 {count} 项 Ghostty 当前无法识别的设置。Studio 会原样保留，并隐藏名称和值。",
            "This file contains {count} {noun} Ghostty does not currently recognize. Studio preserves them and hides their names and values.",
            {
              count: session?.unrecognizedSettingCount ?? 0,
              noun: (session?.unrecognizedSettingCount ?? 0) === 1 ? "setting" : "settings",
            },
          )}</span>
        </div>
      )}
      {!refreshing && (schema?.options.length ?? 0) > 0 && workspaceSummary.editableOptionCount === 0 && (
        <div className="warning-banner" role="status">
          <AlertCircle size={15} />
          <span>{text("这个 Ghostty 版本暂时只能查看；仍可搜索全部设置。", "This Ghostty version is view-only for now; every setting remains searchable.")}</span>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <main className="boot-screen">
        <Ghost size={34} />
        <strong>Ghostty Studio</strong>
        <span>{text("正在读取 Ghostty 配置…", "Loading Ghostty configuration…")}</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Ghost size={20} /></div>
          <div><strong>Ghostty Studio</strong><span>{text("配置工作台", "Configuration workspace")}</span></div>
        </div>

        <div className="sidebar-search search-box">
          <Search size={15} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={text("搜索设置", "Search settings")}
            aria-label={text("搜索设置", "Search settings")}
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              aria-label={text("清除搜索", "Clear search")}
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          ) : <kbd>{primaryModifier}K</kbd>}
        </div>

        <nav className="main-nav" aria-label={text("工作区视图", "Workspace views")}>
          <span className="nav-title">{text("工作区", "Workspace")}</span>
          {(["common", "configured"] as const).map((view) => {
            const Icon = categoryIcon(view);
            return (
              <button
                type="button"
                key={view}
                className={!search && category === view ? "active" : ""}
                aria-current={!search && category === view ? "page" : undefined}
                onClick={() => selectCategory(view)}
              >
                <Icon size={16} />
                <span>{view === "configured" ? text("已设置", "Configured") : text("常用", "Essentials")}</span>
              </button>
            );
          })}
        </nav>

        <nav className="category-nav" aria-label={text("设置分类", "Setting categories")}>
          <span className="nav-title">{text("设置", "Settings")}</span>
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
                <span>{categoryLabel(locale, name)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={!search && category === "catalog" ? "active" : ""}
            aria-current={!search && category === "catalog" ? "page" : undefined}
            onClick={() => selectCategory("catalog")}
          >
            <BookOpen size={16} />
            <span>{text("全部设置", "All settings")}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="source-context" onClick={() => setSourcePanelOpen(true)}>
            <FileText size={16} />
            <span>
              <strong>{activeCandidate?.label ?? text("选择配置", "Choose configuration")}</strong>
              <small>{isDesktop
                ? `Ghostty ${environment?.ghostty.version ?? text("未连接", "Not connected")}`
                : text("试用模式", "Try mode")}</small>
            </span>
            <ChevronRight size={14} />
          </button>
          <details ref={utilityMenuRef} className="utility-menu">
            <summary><MoreHorizontal size={16} /><span>{text("更多", "More")}</span></summary>
            <div className="utility-menu__popover">
              <button type="button" onClick={() => { utilityMenuRef.current?.removeAttribute("open"); openHistory(); }}><History size={15} /> {text("恢复点", "Restore points")}</button>
              <button type="button" onClick={() => { utilityMenuRef.current?.removeAttribute("open"); setSourcePanelOpen(true); }}><Layers3 size={15} /> {text("写入位置", "Write location")}</button>
              <button type="button" onClick={() => { utilityMenuRef.current?.removeAttribute("open"); setGraphOpen(true); }}><FileCog size={15} /> {text("加载顺序", "Load order")}</button>
              {secondaryDiagnostics.length > 0 && (
                <span className="utility-menu__status">
                  {text("{count} 条提醒", "{count} {noun}", {
                    count: secondaryDiagnostics.length,
                    noun: secondaryDiagnostics.length === 1 ? "notice" : "notices",
                  })}
                </span>
              )}
            </div>
          </details>
        </div>
      </aside>

      <main className="workspace">
        <header className="studio-toolbar">
          <div className="studio-toolbar__title">
            <strong>{activeCandidate?.label ?? pageTitle}</strong>
            {activeCandidate && <span>{session?.readOnly ? text("只读配置", "Read-only configuration") : text("当前写入位置", "Current write location")}</span>}
          </div>
          <div className="studio-toolbar__actions">
            <label className="language-picker">
              <Globe2 size={14} aria-hidden="true" />
              <span className="sr-only">{text("界面语言", "Interface language")}</span>
              <select
                value={preference}
                aria-label={text("界面语言", "Interface language")}
                onChange={(event) => setPreference(event.target.value as LanguagePreference)}
              >
                <option value="system">{text("跟随系统", "System")}</option>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button
              type="button"
              className="toolbar-icon"
              aria-label={text("重新读取 Ghostty 配置", "Reload Ghostty configuration")}
              title={text("重新读取", "Reload")}
              onClick={() => void refreshWorkspace(true)}
              disabled={refreshing || applying}
            >
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            </button>
            <span className={`connection-state connection-state--${workspaceSummary.state}`}>
              <i /><span>{isDesktop
                ? `Ghostty ${environment?.ghostty.version ?? text("未找到", "Not found")}`
                : text("试用模式", "Try mode")}</span>
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
                      <strong>{text("Ghostty 设置已更新", "Ghostty settings changed")}</strong>
                      {compatibilityChange.changedKeys.length + compatibilityChange.removedKeys.length > 0
                        ? text(
                            "{count} 项设置需要重新确认。",
                            "{count} {noun} need another review.",
                            {
                              count: compatibilityChange.changedKeys.length + compatibilityChange.removedKeys.length,
                              noun: compatibilityChange.changedKeys.length + compatibilityChange.removedKeys.length === 1 ? "setting" : "settings",
                            },
                          )
                        : text("现有设置仍可继续使用。", "Your existing settings remain compatible.")}
                    </span>
                    <button type="button" onClick={() => setCompatibilityChange(null)}>{text("知道了", "Dismiss")}</button>
                  </div>
                )}

                {showPreview && (
                  <details className="inline-preview">
                    <summary>{text("显示外观预览", "Show appearance preview")}</summary>
                    <TerminalPreview values={previewMode === "draft" ? previewValues : savedPreviewValues} />
                  </details>
                )}

                <div className="settings-groups">
                  {optionGroups.map(([groupName, options]) => (
                    <section className="settings-group" key={groupName || category}>
                      {groupName && <h2>{groupLabel(groupName)}</h2>}
                      <div className="settings-list">
                        {options.map((option) => {
                          const value = draft[option.key] ?? "";
                          const configured = configuredSettings.get(option.key);
                          const configuredInEditingLayer = Boolean(configured);
                          const showAsReference = category === "catalog"
                            || !isGenericallyEditable(option)
                            || (configured?.occurrenceCount ?? 0) > 1
                            || (isDesktop && session.readOnly);
                          return showAsReference ? (
                            <ReferenceSettingRow
                              key={option.key}
                              option={option}
                              configured={configured}
                              effectiveValueKnown={configGraph?.semanticsKnown ?? false}
                              readOnly={isDesktop && session.readOnly}
                              onAdjust={adjustReferencedSetting}
                            />
                          ) : (
                            <SettingRow
                              key={option.key}
                              option={option}
                              value={value}
                              baselineValue={baseline[option.key] ?? ""}
                              configuredInEditingLayer={configuredInEditingLayer}
                              effectiveValueKnown={configGraph?.semanticsKnown ?? false}
                              sourceLabel={activeCandidate?.label ?? text("当前配置", "Current configuration")}
                              onValueChange={updateDraftValue}
                              onReset={resetDraftValue}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                {referenceCountForPage > 0 && (
                  <div className="reference-invitation">
                    <span>{referenceCountForPage === 1
                      ? text("另有 1 项可在完整目录中查看。", "1 more setting is available in the full catalog.")
                      : text(
                          "另有 {count} 项可在完整目录中查看。",
                          "{count} more settings are available in the full catalog.",
                          { count: referenceCountForPage },
                        )}</span>
                    <button type="button" onClick={() => selectCategory("catalog")}>{text("查看全部设置", "View all settings")}</button>
                  </div>
                )}

                {visibleOptions.length === 0 && (
                  <div className="empty-state">
                    <Search size={22} />
                    <strong>{search
                      ? text("没有找到相关设置", "No matching settings")
                      : category === "configured"
                        ? text("这份文件还没有设置项目", "This file has no configured settings yet")
                        : text("这里暂时没有可调整的设置", "No editable settings are available here yet")}</strong>
                    <span>{search
                      ? text("试试功能名称或 Ghostty 配置名。", "Try a feature name or Ghostty configuration key.")
                      : text("从常用设置开始；保存后会出现在这里。", "Start with Essentials; saved settings will appear here.")}</span>
                    {search && <button type="button" className="button button--secondary" onClick={() => setSearch("")}>{text("清除搜索", "Clear search")}</button>}
                  </div>
                )}
              </div>
            </section>

            {showPreview && (
              <aside className="preview-pane">
                <div className="preview-heading">
                  <div><strong>{text("外观预览", "Appearance preview")}</strong><span>{text("模拟效果", "Simulation")}</span></div>
                  <div className="preview-segment" aria-label={text("预览版本", "Preview version")}>
                    <button
                      type="button"
                      className={previewMode === "saved" ? "active" : ""}
                      onClick={() => setPreviewMode("saved")}
                    >
                      {text("已保存", "Saved")}
                    </button>
                    <button
                      type="button"
                      className={previewMode === "draft" ? "active" : ""}
                      onClick={() => setPreviewMode("draft")}
                    >
                      {text("修改后", "Draft")}
                    </button>
                  </div>
                </div>
                <TerminalPreview values={previewMode === "draft" ? previewValues : savedPreviewValues} />
                <p className="preview-note">{text("比较颜色、字体、间距和光标；最终效果以 Ghostty 为准。", "Compare color, type, spacing, and cursor changes. Ghostty remains the source of truth.")}</p>
              </aside>
            )}
          </div>
        )}

        {session && changes.length > 0 && (
          <section className={`draft-dock ${showPreview ? "draft-dock--settings-column" : ""}`} aria-label={text("未保存的修改", "Unsaved changes")}>
            <div role="status" aria-live="polite">
              <span className="draft-dot" />
              <strong>{text(
                "{count} 项修改尚未保存",
                "{count} unsaved {noun}",
                { count: changes.length, noun: changes.length === 1 ? "change" : "changes" },
              )}</strong>
              <small>{text("Ghostty 尚未改变", "Ghostty has not changed")}</small>
            </div>
            <div className="draft-dock__actions">
              <button type="button" className="button button--secondary" onClick={resetAllDraft} disabled={applying}>
                <RotateCcw size={14} /> {text("放弃修改", "Discard")}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void openReview()}
                disabled={reviewLoading || applying}
              >
                {reviewLoading ? text("正在检查…", "Checking…") : isDesktop ? text("检查并保存", "Review & save") : text("查看更改", "Review changes")}
                <kbd>{primaryModifier}S</kbd>
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
                {text("撤销", "Undo")}
              </button>
            )}
            <button
              type="button"
              aria-label={text("关闭提示", "Dismiss message")}
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
          targetLabel={activeCandidate?.label}
          previewOnly={!isDesktop}
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
