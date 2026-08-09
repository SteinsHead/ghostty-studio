import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileText,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { backend, isDesktop } from "./backend";
import { AppearancePreview, type PreviewMode } from "./components/AppearancePreview";
import { ConfigSourcePanel } from "./components/ConfigSourcePanel";
import { BackgroundImageEditor } from "./components/BackgroundImageEditor";
import { ConfigGraphPanel } from "./components/ConfigGraphPanel";
import { Disclosure } from "./components/Disclosure";
import { Presence } from "./components/Presence";
import { ReviewPanel } from "./components/ReviewPanel";
import { ReferenceSettingRow } from "./components/ReferenceSettingRow";
import { SetupPage } from "./components/SetupPage";
import { SettingRow } from "./components/SettingRow";
import { SnapshotHistoryPanel } from "./components/SnapshotHistoryPanel";
import { StudioMark } from "./components/StudioMark";
import { StudioSidebar } from "./components/StudioSidebar";
import { StudioToolbar } from "./components/StudioToolbar";
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
import { DraftMutationGuard, hasSourceBoundRemoval } from "./draftMigration";
import { effectiveDraftPreview, ignoredDraftPreviewKeys } from "./effectivePreview";
import { textForLocale, useI18n, type LocalizedText } from "./i18n";
import { copyForSetting } from "./settingCopy";
import {
  assetIdFromBackgroundValue,
  BACKGROUND_IMAGE_SETTING_KEYS,
  isBackgroundSetting,
  MANAGED_BACKGROUND_PREFIX,
  RESET_BACKGROUND_TOKEN,
  supportsBackgroundImageEditor,
} from "./backgroundImageModel";
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
import {
  backgroundImportFailure,
  errorCode,
  errorMessage,
  matchesMutationUncertainty,
  savedNotice,
  unverifiedChangeEffect,
} from "./studioMessages";
import {
  effectiveValuesForSession,
  initialValues,
  LAST_CATEGORY_KEY,
  MutationCoordinator,
  normalizeViewPreference,
  PREFERRED_CANDIDATE_KEY,
  readPreference,
  valuesForSession,
  writePreference,
  type MutationKind,
  type MutationOperation,
} from "./studioState";
import {
  loadWorkspaceResources,
  workspaceGraphError,
  workspaceResourceMessages,
} from "./workspaceResources";
import type {
  BackgroundAssetSummary,
  BackgroundPreviewState,
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

export default function App() {
  const { locale, preference, setPreference, text } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentGridRef = useRef<HTMLDivElement>(null);
  const settingsPaneRef = useRef<HTMLElement>(null);
  const utilityMenuRef = useRef<HTMLDetailsElement>(null);
  const previousLocaleRef = useRef(locale);
  const localeRef = useRef(locale);
  const pendingFocusKeyRef = useRef<string | null>(null);
  const reviewGuardRef = useRef(new ReviewGuard());
  const openReviewRef = useRef<() => void>(() => undefined);
  const dialogOpenRef = useRef(false);
  const changesRef = useRef<DraftChange[]>([]);
  const draftMutationGuardRef = useRef(new DraftMutationGuard());
  const mutationCoordinatorRef = useRef(new MutationCoordinator());
  const sessionIdentityRef = useRef<{ id: string; revision: string } | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentReport | null>(null);
  const [schema, setSchema] = useState<RuntimeSchema | null>(null);
  const [session, setSession] = useState<ConfigSession | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<ConfigCandidate | null>(null);
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => normalizeViewPreference(readPreference(LAST_CATEGORY_KEY)));
  const [previewMode, setPreviewMode] = useState<PreviewMode>("draft");
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
  const [backgroundAssets, setBackgroundAssets] = useState<BackgroundAssetSummary[]>([]);
  const [backgroundPreviewStates, setBackgroundPreviewStates] = useState<Record<string, BackgroundPreviewState>>({});
  const [backgroundImporting, setBackgroundImporting] = useState(false);
  const [backgroundDeletingAssetId, setBackgroundDeletingAssetId] = useState<string | null>(null);
  const [backgroundFeedback, setBackgroundFeedback] = useState<string | null>(null);
  const backgroundDeletingAssetRef = useRef<string | null>(null);
  const backgroundPreviewRequestsRef = useRef(new Map<string, number>());
  const backgroundPreviewVersionsRef = useRef(new Map<string, number>());
  const deletedBackgroundAssetIdsRef = useRef(new Set<string>());
  const [warning, setWarning] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);

  localeRef.current = locale;
  sessionIdentityRef.current = session
    ? { id: session.id, revision: session.revision }
    : null;
  dialogOpenRef.current = reviewOpen || graphOpen || sourcePanelOpen || historyOpen;

  const beginMutation = (kind: MutationKind): MutationOperation | null => {
    return mutationCoordinatorRef.current.begin(kind);
  };

  const finishMutation = (operation: MutationOperation) => {
    mutationCoordinatorRef.current.finish(operation);
  };

  const mutationIsCurrent = (operation: MutationOperation): boolean => (
    mutationCoordinatorRef.current.isCurrent(operation)
  );

  const currentText: LocalizedText = (zhCN, en, replacements) => (
    textForLocale(localeRef.current, zhCN, en, replacements)
  );

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
      if (
        (event.metaKey || event.ctrlKey)
        && event.key.toLocaleLowerCase() === "k"
        && searchInputRef.current
        && !searchInputRef.current.disabled
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
    loadWorkspaceResources()
      .then(async (resources) => {
        if (cancelled) return;
        setEnvironment(resources.environment);
        setSchema(resources.schema);
        setConfigGraph(resources.graph);
        setGraphError(resources.graph
          ? null
          : workspaceGraphError(localeRef.current, resources.failures)
            ?? currentText("配置来源暂时不可用。", "Configuration sources are temporarily unavailable."));
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
            if (!cancelled) setError(errorMessage(localeRef.current, openError));
          }
        }
        if (!cancelled) {
          const resourceMessages = workspaceResourceMessages(localeRef.current, resources.failures);
          if (resourceMessages.length > 0) setWarning(resourceMessages.join(currentText("；", "; ")));
          setBaseline({ ...values });
          setDraft({ ...values });
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(localeRef.current, nextError));
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

  const refreshBackgroundAssetLibrary = useCallback(async (reportError = true) => {
    if (!isDesktop) return false;
    try {
      const assets = await backend.listBackgroundAssets();
      setBackgroundAssets(assets);
      return true;
    } catch (assetError) {
      if (reportError) setBackgroundFeedback(errorMessage(locale, assetError));
      return false;
    }
  }, [locale]);

  useEffect(() => {
    let canceled = false;
    if (!isDesktop) return undefined;
    backend.listBackgroundAssets()
      .then((assets) => {
        if (!canceled) setBackgroundAssets(assets);
      })
      .catch((assetError) => {
        if (!canceled) setBackgroundFeedback(errorMessage(locale, assetError));
      });
    return () => {
      canceled = true;
    };
  // Changing the interface language must not trigger another filesystem read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestBackgroundPreview = useCallback(async (assetId: string, retry = false) => {
    if (!isDesktop) return;
    if (backgroundPreviewRequestsRef.current.has(assetId)) return;
    const version = (backgroundPreviewVersionsRef.current.get(assetId) ?? 0) + 1;
    backgroundPreviewVersionsRef.current.set(assetId, version);
    backgroundPreviewRequestsRef.current.set(assetId, version);
    setBackgroundPreviewStates((current) => ({
      ...current,
      [assetId]: { status: "loading", dataUrl: current[assetId]?.dataUrl ?? null },
    }));
    try {
      const preview = await backend.getBackgroundAssetPreview(assetId);
      if (
        backgroundPreviewVersionsRef.current.get(assetId) !== version
        || deletedBackgroundAssetIdsRef.current.has(assetId)
      ) return;
      setBackgroundPreviewStates((current) => ({
        ...current,
        [preview.assetId]: { status: "ready", dataUrl: preview.dataUrl },
      }));
    } catch (previewError) {
      if (
        backgroundPreviewVersionsRef.current.get(assetId) !== version
        || deletedBackgroundAssetIdsRef.current.has(assetId)
      ) return;
      setBackgroundPreviewStates((current) => ({
        ...current,
        [assetId]: { status: "error", dataUrl: null },
      }));
      if (retry) setBackgroundFeedback(errorMessage(locale, previewError));
    } finally {
      if (backgroundPreviewRequestsRef.current.get(assetId) === version) {
        backgroundPreviewRequestsRef.current.delete(assetId);
      }
    }
  }, [locale]);

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

  const optionSearchIndex = useMemo(() => new Map(
    workspaceOptions.map((option) => {
      const copy = copyForSetting(locale, option.key, option.description);
      const alternate = copyForSetting(
        locale === "zh-CN" ? "en" : "zh-CN",
        option.key,
        option.description,
      );
      return [option.key, `${option.key} ${copy.label} ${copy.summary ?? ""} ${alternate.label} ${alternate.summary ?? ""} ${option.description} ${categoryLabel(locale, option.category)}`.toLocaleLowerCase()];
    }),
  ), [locale, workspaceOptions]);

  const backgroundOptionMap = useMemo(
    () => new Map(
      workspaceOptions
        .filter((option) => isBackgroundSetting(option.key))
        .map((option) => [option.key, option]),
    ),
    [workspaceOptions],
  );

  const writableCandidateIds = useMemo(
    () => environment?.candidates
      .filter((candidate) => candidate.exists && candidate.writable && !candidate.symlink)
      .map((candidate) => candidate.id) ?? [],
    [environment],
  );

  const backgroundEditorKnown = backgroundOptionMap.has("background-image");
  const backgroundEditorSupported = useMemo(
    () => supportsBackgroundImageEditor(backgroundOptionMap),
    [backgroundOptionMap],
  );

  const backgroundSearchMatch = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return false;
    return [...backgroundOptionMap.keys()].some((key) => optionSearchIndex.get(key)?.includes(needle));
  }, [backgroundOptionMap, optionSearchIndex, search]);

  const backgroundConfigured = BACKGROUND_IMAGE_SETTING_KEYS.some((key) => configuredSettings.has(key));
  const backgroundContextVisible = (
    search
      ? backgroundSearchMatch
      : category === "common"
        || category === "appearance"
        || category === "catalog"
        || (category === "configured" && backgroundConfigured)
  );
  const showBackgroundEditor = backgroundEditorSupported && backgroundContextVisible;
  const showBackgroundCompatibility = backgroundEditorKnown
    && !backgroundEditorSupported
    && backgroundContextVisible;

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

  useEffect(() => {
    if (!session && search) setSearch("");
  }, [search, session]);

  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const options = workspaceOptions.filter((option) => {
      if (needle) return optionSearchIndex.get(option.key)?.includes(needle) ?? false;
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
  }, [workspaceOptions, category, search, configuredSettings, optionSearchIndex]);

  useLayoutEffect(() => {
    const key = pendingFocusKeyRef.current;
    if (!key) return;
    const row = document.getElementById(`setting-${key}`);
    if (!row) return;
    pendingFocusKeyRef.current = null;
    row.scrollIntoView?.({ block: "center" });
    row.querySelector<HTMLElement>(
      ".setting-input button:not([disabled]), .setting-input input:not([disabled]), .setting-input select:not([disabled]), button:not([disabled])",
    )?.focus();
  }, [category, search, visibleOptions]);

  const focusFirstSearchResult = () => {
    const first = (
      search
      && (showBackgroundEditor || showBackgroundCompatibility)
      && visibleOptions.find((option) => isBackgroundSetting(option.key))
    ) || visibleOptions[0];
    if (!first) return;
    const row = document.getElementById(`setting-${first.key}`)
      ?? (isBackgroundSetting(first.key)
        ? document.querySelector<HTMLElement>(".background-editor, .background-compatibility")
        : null);
    if (!row) return;
    row.scrollIntoView?.({ block: "center" });
    const target = row.querySelector<HTMLElement>(
      ".setting-input button:not([disabled]), .setting-input input:not([disabled]), .setting-input select:not([disabled]), button:not([disabled])",
    ) ?? row;
    target.focus();
  };

  const optionGroups = useMemo(() => {
    const grouped = new Map<string, RuntimeOption[]>();
    for (const option of visibleOptions) {
      if (backgroundEditorKnown && isBackgroundSetting(option.key)) continue;
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
  }, [backgroundEditorKnown, category, search, visibleOptions]);

  const referenceCountForPage = useMemo(() => {
    if (search || category === "catalog" || category === "configured") return 0;
    return workspaceOptions.filter((option) => (
      categoryId(option.category) === category
      && !isGenericallyEditable(option)
      && !(backgroundEditorKnown && isBackgroundSetting(option.key))
    )).length;
  }, [backgroundEditorKnown, category, search, workspaceOptions]);

  const changes = useMemo<DraftChange[]>(() => {
    return Object.keys(draft)
      .filter((key) => draft[key] !== baseline[key])
      .map((key) => ({
        key,
        before: key === "background-image"
          ? (baseline[key] ? [baseline[key]] : [])
          : session?.values[key] ?? [],
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

  const effectiveBaseline = useMemo(
    () => session && schema ? effectiveValuesForSession(schema.options, session) : baseline,
    [baseline, schema, session],
  );

  const previewValues = useMemo<Record<string, string>>(
    () => effectiveDraftPreview(
      effectiveBaseline,
      baseline,
      draft,
      session?.settingEffects ?? {},
    ),
    [baseline, draft, effectiveBaseline, session?.settingEffects],
  );

  const previewIgnoredKeys = useMemo(
    () => ignoredDraftPreviewKeys(baseline, draft, session?.settingEffects ?? {}),
    [baseline, draft, session?.settingEffects],
  );

  const savedPreviewValues = useMemo<Record<string, string>>(() => ({
    background: effectiveBaseline.background ?? "",
    foreground: effectiveBaseline.foreground ?? "",
    "font-family": effectiveBaseline["font-family"] ?? "",
    "font-size": effectiveBaseline["font-size"] ?? "",
    "background-opacity": effectiveBaseline["background-opacity"] ?? "",
    "background-image-opacity": effectiveBaseline["background-image-opacity"] ?? "",
    "background-image-fit": effectiveBaseline["background-image-fit"] ?? "",
    "background-image-position": effectiveBaseline["background-image-position"] ?? "",
    "background-image-repeat": effectiveBaseline["background-image-repeat"] ?? "",
    "window-padding-x": effectiveBaseline["window-padding-x"] ?? "",
    "cursor-style": effectiveBaseline["cursor-style"] ?? "",
  }), [
    effectiveBaseline.background,
    effectiveBaseline.foreground,
    effectiveBaseline["font-family"],
    effectiveBaseline["font-size"],
    effectiveBaseline["background-opacity"],
    effectiveBaseline["background-image-opacity"],
    effectiveBaseline["background-image-fit"],
    effectiveBaseline["background-image-position"],
    effectiveBaseline["background-image-repeat"],
    effectiveBaseline["window-padding-x"],
    effectiveBaseline["cursor-style"],
  ]);

  const draftBackgroundAssetId = assetIdFromBackgroundValue(previewValues["background-image"]);
  const savedBackgroundAssetId = assetIdFromBackgroundValue(effectiveBaseline["background-image"]);
  const backgroundPresentationConfigured = BACKGROUND_IMAGE_SETTING_KEYS
    .slice(1)
    .some((key) => configuredSettings.has(key) || draft[key] !== baseline[key]);
  const draftBackgroundPreviewState = draftBackgroundAssetId
    ? backgroundPreviewStates[draftBackgroundAssetId]
    : null;
  const savedBackgroundPreviewState = savedBackgroundAssetId
    ? backgroundPreviewStates[savedBackgroundAssetId]
    : null;
  const draftBackgroundPreview = draftBackgroundAssetId
    && draftBackgroundPreviewState?.status === "ready"
    && draftBackgroundPreviewState.dataUrl
    ? {
        dataUrl: draftBackgroundPreviewState.dataUrl,
        name: backgroundAssets.find((asset) => asset.id === draftBackgroundAssetId)?.displayName,
      }
    : null;
  const savedBackgroundPreview = savedBackgroundAssetId
    && savedBackgroundPreviewState?.status === "ready"
    && savedBackgroundPreviewState.dataUrl
    ? {
        dataUrl: savedBackgroundPreviewState.dataUrl,
        name: backgroundAssets.find((asset) => asset.id === savedBackgroundAssetId)?.displayName,
      }
    : null;

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
    ? text("{count} 项结果", "{count} {noun}", {
        count: visibleOptions.length,
        noun: visibleOptions.length === 1 ? "result" : "results",
      })
    : "";

  const updateDraftValue = useCallback((key: string, value: string) => {
    reviewGuardRef.current.invalidate();
    draftMutationGuardRef.current.invalidate();
    setNotice(null);
    setDiscardedDraft(null);
    setDraft((current) => current[key] === value
      ? current
      : { ...current, [key]: value });
  }, []);

  const importBackgroundImages = useCallback(async () => {
    if (!isDesktop || backgroundImporting || session?.readOnly) return;
    setBackgroundImporting(true);
    setBackgroundFeedback(null);
    try {
      const result = await backend.chooseBackgroundImages();
      if (result.canceled) return;
      if (result.assets.length > 0) {
        const importedIds = new Set(result.assets.map((asset) => asset.id));
        for (const assetId of importedIds) {
          deletedBackgroundAssetIdsRef.current.delete(assetId);
          const nextVersion = (backgroundPreviewVersionsRef.current.get(assetId) ?? 0) + 1;
          backgroundPreviewVersionsRef.current.set(assetId, nextVersion);
          backgroundPreviewRequestsRef.current.delete(assetId);
        }
        setBackgroundPreviewStates((current) => {
          const next = { ...current };
          for (const assetId of importedIds) {
            if (next[assetId]?.status === "error") {
              next[assetId] = { status: "idle", dataUrl: null };
            }
          }
          return next;
        });
        setBackgroundAssets((current) => {
          const merged = new Map(current.map((asset) => [asset.id, asset]));
          for (const asset of result.assets) merged.set(asset.id, asset);
          return [...merged.values()].sort((left, right) => right.importedAtMs - left.importedAtMs);
        });
        const selectedAsset = result.assets[0];
        updateDraftValue(
          "background-image",
          `${MANAGED_BACKGROUND_PREFIX}${selectedAsset.id}`,
        );
        void requestBackgroundPreview(selectedAsset.id, true);
      }
      if (result.rejected.length === 0) {
        setBackgroundFeedback(text(
          result.assets.length === 1
            ? "图片已选择。"
            : "已选择第一张图片，其余 {remaining} 张已加入图库。",
          result.assets.length === 1
            ? "Image selected."
            : "The first image is selected; {remaining} more were added to your library.",
          { remaining: Math.max(0, result.assets.length - 1) },
        ));
      } else {
        const first = result.rejected[0];
        setBackgroundFeedback(text(
          "已加入 {count} 张；{name}：{reason}",
          "Added {count}. {name}: {reason}",
          {
            count: result.assets.length,
            name: first.displayName,
            reason: backgroundImportFailure(locale, first.code),
          },
        ));
      }
    } catch (importError) {
      setBackgroundFeedback(errorMessage(locale, importError));
    } finally {
      setBackgroundImporting(false);
    }
  }, [
    backgroundImporting,
    locale,
    requestBackgroundPreview,
    session?.readOnly,
    text,
    updateDraftValue,
  ]);

  const deleteBackgroundImage = useCallback(async (assetId: string) => {
    if (!isDesktop || session?.readOnly || backgroundDeletingAssetRef.current !== null) return;
    const asset = backgroundAssets.find((item) => item.id === assetId);
    if (!asset || asset.usage.status !== "available") {
      setSourcePanelOpen(true);
      return;
    }
    backgroundDeletingAssetRef.current = assetId;
    setBackgroundDeletingAssetId(assetId);
    try {
      await backend.deleteBackgroundAsset(assetId, locale);
      setBackgroundAssets((current) => current.filter((asset) => asset.id !== assetId));
      deletedBackgroundAssetIdsRef.current.add(assetId);
      backgroundPreviewVersionsRef.current.set(
        assetId,
        (backgroundPreviewVersionsRef.current.get(assetId) ?? 0) + 1,
      );
      backgroundPreviewRequestsRef.current.delete(assetId);
      setBackgroundPreviewStates((current) => {
        if (!current[assetId]) return current;
        const next = { ...current };
        delete next[assetId];
        return next;
      });
      setBackgroundFeedback(text(
        "已从图库删除。",
        "Removed from library.",
      ));
    } catch (deleteError) {
      if (errorCode(deleteError) === "native_confirmation_cancelled") return;
      setBackgroundFeedback(errorMessage(locale, deleteError));
      if (["background_asset_in_use", "background_asset_usage_unknown"].includes(errorCode(deleteError) ?? "")) {
        await refreshBackgroundAssetLibrary(false);
      }
    } finally {
      backgroundDeletingAssetRef.current = null;
      setBackgroundDeletingAssetId(null);
    }
  }, [
    backgroundAssets,
    locale,
    refreshBackgroundAssetLibrary,
    session?.readOnly,
    text,
  ]);

  const resetDraftValue = useCallback((key: string, baselineValue: string) => {
    reviewGuardRef.current.invalidate();
    draftMutationGuardRef.current.invalidate();
    setNotice(null);
    setDiscardedDraft(null);
    setDraft((current) => current[key] === baselineValue
      ? current
      : { ...current, [key]: baselineValue });
  }, []);

  const resetAllDraft = useCallback(() => {
    reviewGuardRef.current.invalidate();
    draftMutationGuardRef.current.invalidate();
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
    draftMutationGuardRef.current.invalidate();
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
    if (refreshing || applying || switchingCandidateId || mutationCoordinatorRef.current.busy) return false;
    const operation = beginMutation("refresh");
    if (!operation) return false;
    const capturedDraftVersion = draftMutationGuardRef.current.capture();
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
      const stopForNewerState = () => {
        if (
          mutationIsCurrent(operation)
          && draftMutationGuardRef.current.isCurrent(capturedDraftVersion)
        ) return false;
        setWarning(currentText(
          "读取期间草稿已变化，未应用旧结果。请重试。",
          "The draft changed while reloading, so the older result was not applied. Try again.",
        ));
        return true;
      };
      if (stopForNewerState()) return false;
      const applyResourceMetadata = () => {
        setEnvironment(resources.environment);
        setSchema(resources.schema);
        setConfigGraph(resources.graph);
        setGraphError(resources.graph
          ? null
          : workspaceGraphError(localeRef.current, resources.failures)
            ?? currentText("配置来源暂时不可用。", "Configuration sources are temporarily unavailable."));
      };

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
        applyResourceMetadata();
        setActiveCandidate(sameCandidate ? candidate : null);
        setSession(null);
        setNotice(null);
        setSourceError(null);
        const reason = !resources.schema
          ? currentText("可用设置暂时无法读取", "available settings could not be loaded")
          : currentText("原配置位置已经变化", "the original configuration location changed");
        const resourceMessages = workspaceResourceMessages(localeRef.current, resources.failures);
        setWarning([
          currentText(
            "{reason}；{count} 项草稿仍保留在本次会话中。重新连接原配置，或选择其他配置后再继续。",
            "Because {reason}, {count} draft {noun} remain in this session. Reconnect the original configuration or choose another one to continue.",
            { reason, count: capturedChanges.length, noun: capturedChanges.length === 1 ? "change" : "changes" },
          ),
          ...resourceMessages,
        ].join(currentText("；", "; ")));
        return true;
      }

      const nextValues = initialValues(resources.schema?.options ?? []);
      let opened: ConfigSession | null = null;
      if (candidate && resources.schema) {
        try {
          opened = await backend.openConfig(candidate.id);
          if (stopForNewerState()) return false;
          Object.assign(nextValues, valuesForSession(resources.schema.options, opened));
        } catch (openError) {
          if (stopForNewerState()) return false;
          applyResourceMetadata();
          setActiveCandidate(candidate);
          setSession(null);
          if (hasRecoverableDraft) {
            setWarning(
              currentText(
                "暂时无法重新打开 {target}；{count} 项草稿仍保留在本次会话中。{error}",
                "Could not reopen {target}. {count} draft {noun} remain in this session. {error}",
                {
                  target: candidate.label,
                  count: capturedChanges.length,
                  noun: capturedChanges.length === 1 ? "change" : "changes",
                  error: errorMessage(localeRef.current, openError),
                },
              ),
            );
            return false;
          }
          throw openError;
        }
      }
      if (stopForNewerState()) return false;
      applyResourceMetadata();
      setActiveCandidate(candidate);
      setSession(opened);
      setBaseline({ ...nextValues });

      const nextDraft = { ...nextValues };
      let preservedCount = 0;
      if (hasRecoverableDraft && sameCandidate && resources.schema) {
        const options = new Map(resources.schema.options.map((option) => [option.key, option]));
        for (const change of capturedChanges) {
          const option = options.get(change.key);
          if (
            change.key === "background-image"
            && option?.capability.reason === "needs-editor"
            && change.after.length <= 1
          ) {
            const next = change.after[0] ?? "";
            if (next === "" || next === RESET_BACKGROUND_TOKEN || assetIdFromBackgroundValue(next)) {
              nextDraft[change.key] = next;
              if (nextDraft[change.key] !== nextValues[change.key]) preservedCount += 1;
            }
            continue;
          }
          if (!option || !isGenericallyEditable(option) || change.after.length > 1) continue;
          nextDraft[change.key] = change.after[0] ?? "";
          if (nextDraft[change.key] !== nextValues[change.key]) preservedCount += 1;
        }
      }
      setDraft(nextDraft);
      setNotice(
        preservedCount > 0
          ? currentText(
              "已重新读取配置，保留 {count} 项草稿。请再次检查。",
              "Configuration reloaded with {count} draft {noun} preserved. Review again.",
              { count: preservedCount, noun: preservedCount === 1 ? "change" : "changes" },
            )
          : currentText("已重新读取配置。", "Configuration reloaded."),
      );
      setSourceError(null);
      const resourceMessages = workspaceResourceMessages(localeRef.current, resources.failures);
      if (resourceMessages.length > 0) {
        setWarning(resourceMessages.join(currentText("；", "; ")));
      }
      void refreshBackgroundAssetLibrary(false);
      return true;
    } catch (refreshError) {
      setError(currentText(
        "重新检查失败：{error}",
        "Check failed: {error}",
        { error: errorMessage(localeRef.current, refreshError) },
      ));
      return false;
    } finally {
      setRefreshing(false);
      finishMutation(operation);
    }
  };

  const switchCandidate = async (candidate: ConfigCandidate): Promise<boolean> => {
    if (!schema || switchingCandidateId || applying || restoringSnapshotId) return false;
    const operation = beginMutation("source");
    if (!operation) return false;
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
        "已切换到 {target}。",
        "Switched to {target}.",
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
      finishMutation(operation);
    }
  };

  const moveDraftToCandidate = async (candidateId: string): Promise<boolean> => {
    if (!schema || switchingCandidateId || applying || restoringSnapshotId) return false;
    const capturedChanges = (changePreview?.changes ?? changesRef.current)
      .map((change) => ({
        ...change,
        before: [...change.before],
        after: [...change.after],
      }));
    if (hasSourceBoundRemoval(capturedChanges)) {
      const message = text(
        "草稿包含“从当前文件移除”，不能直接搬到另一配置来源。请先返回编辑，再打开目标来源重新确认。",
        "This draft removes a value from the current file, so it cannot be moved to another configuration source. Return to editing, then open the target source and confirm again.",
      );
      setSourceError(message);
      setWarning(message);
      setReviewOpen(false);
      setChangePreview(null);
      return false;
    }
    const operation = beginMutation("source");
    if (!operation) return false;
    const capturedDraftVersion = draftMutationGuardRef.current.capture();
    const capturedSessionIdentity = sessionIdentityRef.current
      ? { ...sessionIdentityRef.current }
      : null;
    reviewGuardRef.current.invalidate();
    setSwitchingCandidateId(candidateId);
    setSourceError(null);
    try {
      let nextEnvironment = environment;
      let candidate = nextEnvironment?.candidates.find((item) => item.id === candidateId) ?? null;
      if (!candidate) {
        nextEnvironment = await backend.probeEnvironment();
        setEnvironment(nextEnvironment);
        candidate = nextEnvironment.candidates.find((item) => item.id === candidateId) ?? null;
      }
      if (!candidate) {
        const message = text(
          "建议的生效来源已经变化，请重新检查草稿。",
          "The suggested effective source has changed. Check the draft again.",
        );
        setSourceError(message);
        setWarning(message);
        setReviewOpen(false);
        setChangePreview(null);
        return false;
      }
      if (!candidate.exists || !candidate.writable || candidate.symlink) {
        setSourceError(text(
          "{target} 目前不能安全写入，请在来源面板中检查。",
          "{target} cannot be written safely right now. Check it in the source panel.",
          { target: candidate.label },
        ));
        setReviewOpen(false);
        setSourcePanelOpen(true);
        return false;
      }

      const opened = await backend.openConfig(candidate.id);
      const currentSessionIdentity = sessionIdentityRef.current;
      const sessionUnchanged = capturedSessionIdentity === null
        ? currentSessionIdentity === null
        : currentSessionIdentity?.id === capturedSessionIdentity.id
          && currentSessionIdentity.revision === capturedSessionIdentity.revision;
      const operationCurrent = mutationIsCurrent(operation);
      if (
        !operationCurrent
        || !draftMutationGuardRef.current.isCurrent(capturedDraftVersion)
        || !sessionUnchanged
      ) {
        const message = text(
          "草稿或配置已发生变化，因此没有切换写入位置。请重新检查后再试。",
          "The draft or configuration changed, so the write location was not switched. Review and try again.",
        );
        setSourceError(message);
        setWarning(message);
        setReviewOpen(false);
        setChangePreview(null);
        return false;
      }
      const nextValues = valuesForSession(schema.options, opened);
      const nextDraft = { ...nextValues };
      let preservedCount = 0;
      let skippedCount = 0;
      for (const change of capturedChanges) {
        const option = schema.options.find((item) => item.key === change.key);
        if (
          change.key === "background-image"
          && option?.capability.reason === "needs-editor"
          && change.after.length <= 1
        ) {
          const next = change.after[0] ?? "";
          if (next === "" || next === RESET_BACKGROUND_TOKEN || assetIdFromBackgroundValue(next)) {
            nextDraft[change.key] = next;
            if (next !== nextValues[change.key]) preservedCount += 1;
          } else {
            skippedCount += 1;
          }
          continue;
        }
        if (option && isGenericallyEditable(option) && change.after.length <= 1) {
          const next = change.after[0] ?? "";
          nextDraft[change.key] = next;
          if (next !== nextValues[change.key]) preservedCount += 1;
        } else {
          skippedCount += 1;
        }
      }

      setActiveCandidate(candidate);
      writePreference(PREFERRED_CANDIDATE_KEY, candidate.id);
      setSession(opened);
      setBaseline(nextValues);
      setDraft(nextDraft);
      setChangePreview(null);
      setReviewFailureCode(null);
      void refreshBackgroundAssetLibrary(false);
      setReviewOpen(false);
      setSourcePanelOpen(false);
      setWarning(skippedCount > 0
        ? text(
            "{count} 项设置不能移到新位置，其余草稿已保留。请检查后再保存。",
            "{count} {noun} could not be moved. The remaining draft was preserved; review it before saving.",
            {
              count: skippedCount,
              noun: skippedCount === 1 ? "setting" : "settings",
            },
          )
        : null);
      setNotice(preservedCount > 0
        ? text(
            "已改为保存到 {target}；{count} 项草稿仍未保存。",
            "The save destination is now {target}. {count} draft {noun} are still unsaved.",
            {
              target: candidate.label,
              count: preservedCount,
              noun: preservedCount === 1 ? "change" : "changes",
            },
          )
        : text(
            "已切换到 {target}，修改尚未保存。",
            "Switched to {target}. Changes are not yet saved.",
            { target: candidate.label },
          ));
      setError(null);
      return true;
    } catch (moveError) {
      setSourceError(errorMessage(locale, moveError));
      setReviewOpen(false);
      setSourcePanelOpen(true);
      return false;
    } finally {
      setSwitchingCandidateId(null);
      finishMutation(operation);
    }
  };

  const createCandidate = async (candidate: ConfigCandidate): Promise<boolean> => {
    if (!schema || switchingCandidateId || applying || restoringSnapshotId || !isDesktop) return false;
    const operation = beginMutation("source");
    if (!operation) return false;
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
        "已创建并打开 {target}。",
        "Created and opened {target}.",
        { target: candidate.label },
      ));
      const creationWarnings = opened.diagnostics.some((diagnostic) => (
        diagnostic.includes("fsync") || diagnostic.includes("耐久性")
      ))
        ? [text(
            "配置已创建，但无法确认已完整写入磁盘。请重新检查。",
            "The configuration was created, but a complete disk write could not be confirmed. Check it again.",
          )]
        : [];
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
      finishMutation(operation);
    }
  };

  const openReview = async () => {
    if (
      changes.length === 0
      || reviewLoading
      || applying
      || restoringSnapshotId
      || switchingCandidateId
      || mutationCoordinatorRef.current.busy
    ) return;
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
          effect: unverifiedChangeEffect(reviewedChanges),
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
        effect: unverifiedChangeEffect(reviewedChanges),
      });
    } finally {
      if (reviewGuardRef.current.isCurrent(requestId)) setReviewLoading(false);
    }
  };

  openReviewRef.current = () => {
    if (
      session
      && changesRef.current.length > 0
      && !mutationCoordinatorRef.current.busy
      && !switchingCandidateId
      && !restoringSnapshotId
    ) void openReview();
  };

  const applyReviewedChanges = async () => {
    if (
      !session
      || !changePreview?.valid
      || changePreview.effect.status !== "effective"
      || switchingCandidateId
      || restoringSnapshotId
    ) return;
    const operation = beginMutation("apply");
    if (!operation) return;
    if (!changeSetsEqual(changePreview.changes, changesRef.current)) {
      setReviewFailureCode("draft_changed");
      setChangePreview((current) => current ? {
        ...current,
        token: "",
        valid: false,
        diagnostics: [...current.diagnostics, text("草稿已经变化，保存已停止。请重新检查。", "The draft changed, so saving was stopped. Check it again.")],
      } : current);
      finishMutation(operation);
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
        if (change.key === "background-image") continue;
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
      let workspaceReopenFailed = false;
      if (activeCandidate && schema) {
        try {
          nextSession = await backend.openConfig(activeCandidate.id);
        } catch (reopenError) {
          workspaceReopenFailed = true;
          setWarning(text(
            "配置已保存，但工作区刷新失败。请重新检查。{error}",
            "The configuration was saved, but the workspace could not be refreshed. Check again. {error}",
            { error: errorMessage(locale, reopenError) },
          ));
        }
      }
      if (
        workspaceReopenFailed
        && reviewedChanges.some((change) => change.key === "background-image")
      ) {
        setSession(null);
        setBaseline({});
        setDraft({});
        setNotice(savedNotice(locale, result.activation, result.effectiveStatus, activeCandidate?.label));
        reviewGuardRef.current.invalidate();
        setReviewOpen(false);
        setChangePreview(null);
        setReviewFailureCode(null);
        return;
      }
      setSession(nextSession);
      const nextValues = schema ? valuesForSession(schema.options, nextSession) : { ...draft };
      setBaseline(nextValues);
      setDraft({ ...nextValues });
      setNotice(savedNotice(locale, result.activation, result.effectiveStatus, activeCandidate?.label));
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
            if (
              change.key === "background-image"
              && option?.capability.reason === "needs-editor"
              && change.after.length <= 1
            ) {
              const next = change.after[0] ?? "";
              if (next === "" || next === RESET_BACKGROUND_TOKEN || assetIdFromBackgroundValue(next)) {
                rebasedDraft[change.key] = next;
              }
              continue;
            }
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
        effect: current?.effect ?? unverifiedChangeEffect(reviewedChanges),
      }));
    } finally {
      setApplying(false);
      finishMutation(operation);
    }
  };

  const reviewCanRecover = [
    "revision_conflict",
    "ghostty_contract_changed",
    "ghostty_contract_read_only",
    "ghostty_runtime_changed",
    "ghostty_runtime_changed_after_write",
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
    if (mutationCoordinatorRef.current.busy || switchingCandidateId || applying || restoringSnapshotId) return;
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
    if (switchingCandidateId || applying || restoringSnapshotId) return false;
    const operation = beginMutation("restore");
    if (!operation) return false;

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

      setHistoryNotice(text("恢复完成。", "Restore complete."));
      setNotice(savedNotice(locale, result.activation, result.effectiveStatus));
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
        void refreshBackgroundAssetLibrary(false);
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
      finishMutation(operation);
    }
  };

  const groupLabel = (group: string) => {
    if (group === "search-editable") return text("可直接调整", "Editable here");
    if (group === "search-reference") return text("设置参考", "Reference settings");
    if (group === "configured-editable") return text("可在这里调整", "Editable here");
    if (group === "configured-reference") return text("在配置文件中管理", "Managed in the config file");
    return categoryLabel(locale, group);
  };

  const platform = environment?.platform.toLocaleLowerCase() ?? "";
  const primaryModifier = platform.includes("mac") ? "⌘" : "Ctrl";
  const searchLabel = text("搜索名称或 Ghostty 配置项", "Search names or Ghostty keys");
  const reloadLabel = refreshing
    ? text("正在重新读取 Ghostty 配置…", "Reloading Ghostty configuration…")
    : text("重新读取 Ghostty 配置", "Reload Ghostty configuration");
  const connectionLabel = isDesktop
    ? `Ghostty ${environment?.ghostty.version ?? text("未找到", "Not found")}`
    : text("试用模式", "Try mode");

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
          <span>{text("正在重新读取配置…", "Reloading configuration…")}</span>
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
            "{count} 项设置无法识别，已原样保留。",
            "{count} unrecognized {noun} preserved unchanged.",
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
          <span>{text("当前 Ghostty 版本暂不支持编辑。", "Editing is unavailable for this Ghostty version.")}</span>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <main className="boot-screen" aria-busy="true">
        <StudioMark size={38} />
        <strong>Ghostty Studio</strong>
        <span role="status" aria-live="polite">
          {text("正在读取 Ghostty 配置…", "Loading Ghostty configuration…")}
        </span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <StudioSidebar
        searchInputRef={searchInputRef}
        utilityMenuRef={utilityMenuRef}
        search={search}
        searchLabel={searchLabel}
        primaryModifier={primaryModifier}
        workspaceReady={Boolean(session)}
        category={category}
        categories={categories}
        locale={locale}
        activeCandidate={activeCandidate}
        desktop={isDesktop}
        ghosttyVersion={environment?.ghostty.version ?? null}
        busy={switchingCandidateId !== null || applying || restoringSnapshotId !== null}
        text={text}
        onSearch={setSearch}
        onFocusFirstResult={focusFirstSearchResult}
        onSelectCategory={selectCategory}
        onOpenHistory={openHistory}
        onOpenSource={() => setSourcePanelOpen(true)}
        onOpenGraph={() => setGraphOpen(true)}
      />

      <main className="workspace">
        <StudioToolbar
          activeLabel={activeCandidate?.label}
          fallbackTitle={pageTitle}
          readOnly={session?.readOnly ?? false}
          preference={preference}
          refreshing={refreshing}
          busy={applying || switchingCandidateId !== null}
          reloadLabel={reloadLabel}
          connectionLabel={connectionLabel}
          connectionState={workspaceSummary.state}
          text={text}
          onPreferenceChange={setPreference}
          onRefresh={() => void refreshWorkspace(true)}
        />

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
                    {pageDescription && (
                      <p id="search-result-count" role="status" aria-live="polite" aria-atomic="true">
                        {pageDescription}
                      </p>
                    )}
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
                  <Disclosure
                    className="inline-preview"
                    summary={<><ChevronRight size={13} /> {text("显示外观预览", "Show appearance preview")}</>}
                    summaryLabel={text("显示或隐藏外观预览", "Show or hide appearance preview")}
                    bodyClassName="inline-preview__body"
                  >
                    <AppearancePreview
                      variant="inline"
                      mode={previewMode}
                      effectiveKnown={session.effectiveValuesKnown}
                      savedValues={savedPreviewValues}
                      draftValues={previewValues}
                      savedBackgroundImage={savedBackgroundPreview}
                      draftBackgroundImage={draftBackgroundPreview}
                      ignoredChangeCount={previewIgnoredKeys.length}
                      onModeChange={setPreviewMode}
                    />
                  </Disclosure>
                )}

                {showBackgroundEditor && (
                  <BackgroundImageEditor
                    assets={backgroundAssets}
                    previewStates={backgroundPreviewStates}
                    value={draft["background-image"] ?? ""}
                    baselineValue={baseline["background-image"] ?? ""}
                    effectiveValue={effectiveBaseline["background-image"] ?? ""}
                    values={draft}
                    baselineValues={baseline}
                    effectiveValues={effectiveBaseline}
                    options={backgroundOptionMap}
                    disabled={!isDesktop || session.readOnly || refreshing || switchingCandidateId !== null || applying || restoringSnapshotId !== null}
                    desktop={isDesktop}
                    importing={backgroundImporting}
                    deletingAssetId={backgroundDeletingAssetId}
                    feedback={backgroundFeedback}
                    showInactivePreferences={backgroundPresentationConfigured}
                    effectiveKnown={session.effectiveValuesKnown}
                    effects={session.settingEffects}
                    writableCandidateIds={writableCandidateIds}
                    onImport={() => void importBackgroundImages()}
                    onPreviewRequest={requestBackgroundPreview}
                    onSelect={(assetId) => updateDraftValue(
                      "background-image",
                      `${MANAGED_BACKGROUND_PREFIX}${assetId}`,
                    )}
                    onDelete={(assetId) => void deleteBackgroundImage(assetId)}
                    onRemove={() => updateDraftValue("background-image", RESET_BACKGROUND_TOKEN)}
                    onInspectReferences={() => setSourcePanelOpen(true)}
                    onChange={updateDraftValue}
                    onUseEffectiveSource={(candidateId) => void moveDraftToCandidate(candidateId)}
                  />
                )}

                {showBackgroundCompatibility && (
                  <section
                    id="setting-background-image"
                    className="background-compatibility"
                    aria-labelledby="background-compatibility-title"
                    tabIndex={-1}
                  >
                    <h2 id="background-compatibility-title">{text("背景图片暂不可编辑", "Background image editing is unavailable")}</h2>
                    <p>{text(
                      "Ghostty 更新了此设置；现有配置未更改。",
                      "Ghostty changed this setting. Your configuration is unchanged.",
                    )}</p>
                  </section>
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
                            || configured?.valueExposure === "protected"
                            || (isDesktop && session.readOnly);
                          return showAsReference ? (
                            <ReferenceSettingRow
                              key={option.key}
                              option={option}
                              configured={configured}
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

                {visibleOptions.length === 0 && !showBackgroundEditor && !showBackgroundCompatibility && (
                  <div className="empty-state">
                    <Search size={22} />
                    <strong>{search
                      ? text(
                          "没有找到与“{query}”相关的设置",
                          "No settings found for “{query}”",
                          { query: search },
                        )
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
                <AppearancePreview
                  mode={previewMode}
                  effectiveKnown={session.effectiveValuesKnown}
                  savedValues={savedPreviewValues}
                  draftValues={previewValues}
                  savedBackgroundImage={savedBackgroundPreview}
                  draftBackgroundImage={draftBackgroundPreview}
                  ignoredChangeCount={previewIgnoredKeys.length}
                  onModeChange={setPreviewMode}
                />
              </aside>
            )}
          </div>
        )}

        <Presence show={Boolean(session && changes.length > 0)} className="draft-presence">
          {session && (
            <section className={`draft-dock ${showPreview ? "draft-dock--settings-column" : ""}`} aria-label={text("未保存的修改", "Unsaved changes")}>
              <div role="status" aria-live="polite">
                <span className="draft-dot" />
                <strong>{text(
                  "{count} 项修改尚未保存",
                  "{count} unsaved {noun}",
                  { count: changes.length, noun: changes.length === 1 ? "change" : "changes" },
                )}</strong>
              </div>
              <div className="draft-dock__actions">
                <button type="button" className="button button--secondary" onClick={resetAllDraft} disabled={refreshing || applying || switchingCandidateId !== null || restoringSnapshotId !== null}>
                  <RotateCcw size={14} /> {text("放弃修改", "Discard")}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void openReview()}
                  disabled={refreshing || reviewLoading || applying || switchingCandidateId !== null || restoringSnapshotId !== null}
                >
                  {reviewLoading ? text("正在检查…", "Checking…") : isDesktop ? text("检查并保存", "Review & save") : text("查看更改", "Review changes")}
                  <kbd>{primaryModifier}S</kbd>
                </button>
              </div>
            </section>
          )}
        </Presence>

        <Presence show={Boolean(notice)} className="toast-presence">
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
        </Presence>
      </main>

      <Presence show={reviewOpen || graphOpen || sourcePanelOpen || historyOpen}>
        {reviewOpen ? (
          <ReviewPanel
            changes={changes}
            preview={changePreview}
            loading={reviewLoading}
            applying={applying}
            busy={switchingCandidateId !== null || restoringSnapshotId !== null}
            canRecover={reviewCanRecover}
            readOnly={session?.readOnly ?? true}
            targetLabel={activeCandidate?.label}
            previewOnly={!isDesktop}
            backgroundAssetNames={Object.fromEntries(backgroundAssets.map((asset) => [asset.id, asset.displayName]))}
            onClose={closeReview}
            onApply={applyReviewedChanges}
            onRetry={() => void openReview()}
            onRecover={() => void recoverReview()}
            onUseSuggestedSource={(candidateId) => void moveDraftToCandidate(candidateId)}
          />
        ) : graphOpen ? (
          <ConfigGraphPanel
            graph={configGraph}
            loading={refreshing}
            error={graphError}
            onClose={() => setGraphOpen(false)}
            onRetry={() => void refreshWorkspace(true)}
          />
        ) : sourcePanelOpen ? (
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
        ) : historyOpen ? (
          <SnapshotHistoryPanel
            snapshots={snapshots}
            loading={historyLoading}
            error={historyError}
            success={historyNotice}
            readOnly={!isDesktop || (session?.readOnly ?? true)}
            busy={switchingCandidateId !== null || applying}
            pendingChanges={changes.length}
            restoringId={restoringSnapshotId}
            onClose={() => setHistoryOpen(false)}
            onRetry={() => void loadSnapshots()}
            onRestore={restoreSnapshot}
          />
        ) : null}
      </Presence>
    </div>
  );
}
