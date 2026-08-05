import type {
  ConfigGraph,
  ConfigSession,
  EnvironmentReport,
  RuntimeOption,
  RuntimeSchema,
} from "./types";
import { textForLocale, type AppLocale } from "./i18n";

export type WorkspaceState = "ready" | "attention" | "blocked" | "demo";

export interface WorkspaceSummary {
  state: WorkspaceState;
  title: string;
  description: string;
  existingConfigCount: number;
  editableOptionCount: number;
  protectedOptionCount: number;
  issueCount: number;
}

export interface CompatibilitySnapshot {
  version: 1;
  ghosttyVersion: string | null;
  schemaHash: string;
  optionKeys: string[];
  optionFingerprints: Record<string, string>;
}

export interface CompatibilityChange {
  previousVersion: string | null;
  currentVersion: string | null;
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
  schemaChanged: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const COMPATIBILITY_STORAGE_KEY = "ghostty-studio.compatibility.v1";
const MAX_STORED_SNAPSHOT_BYTES = 256 * 1024;
const MAX_OPTION_KEYS = 5_000;
const MAX_KEY_LENGTH = 256;

export function isGenericallyEditable(option: RuntimeOption): boolean {
  return option.editable === true
    && option.capability.editMode === "control"
    && !option.repeatable
    && option.risk === "normal";
}

export function deriveWorkspaceSummary(
  environment: EnvironmentReport | null,
  schema: RuntimeSchema | null,
  session: ConfigSession | null,
  graph: ConfigGraph | null,
  desktop: boolean,
  locale: AppLocale = "zh-CN",
): WorkspaceSummary {
  const options = schema?.options ?? [];
  const editableOptionCount = options.filter(isGenericallyEditable).length;
  const existingConfigCount = environment?.candidates.filter((item) => item.exists).length ?? 0;
  const warnings = (environment?.warnings.length ?? 0)
    + (schema?.diagnostics.length ?? 0)
    + (session?.diagnostics.length ?? 0)
    + (graph?.diagnostics.length ?? 0)
    + (graph && !graph.complete ? 1 : 0);
  const base = {
    existingConfigCount,
    editableOptionCount,
    protectedOptionCount: Math.max(0, options.length - editableOptionCount),
    issueCount: warnings,
  };

  if (!desktop) {
    return {
      ...base,
      state: "demo",
      title: textForLocale(locale, "先体验，再决定是否接入本机配置", "Explore before connecting local configuration"),
      description: textForLocale(locale, "当前是安全试用模式，可以体验交互，但不会读写本机文件。", "Try mode lets you explore the interface without reading or writing local files."),
    };
  }
  if (!environment?.ghostty.available) {
    return {
      ...base,
      state: "blocked",
      title: textForLocale(locale, "还没有找到 Ghostty", "Ghostty was not found"),
      description: textForLocale(locale, "安装或重新打开 Ghostty 后再次检查；在此之前，配置保持只读。", "Install or reopen Ghostty, then check again. Configuration remains read-only until then."),
    };
  }
  if (!schema || options.length === 0) {
    return {
      ...base,
      state: "blocked",
      title: textForLocale(locale, "无法读取当前 Ghostty 的可用设置", "Ghostty settings could not be loaded"),
      description: textForLocale(locale, "Studio 不会猜测未知设置，编辑已安全暂停。", "Studio does not guess unknown settings, so editing has been paused safely."),
    };
  }
  if (existingConfigCount === 0 || !session) {
    return {
      ...base,
      state: "attention",
      title: textForLocale(locale, "选择一份配置后开始", "Choose a configuration to begin"),
      description: textForLocale(locale, "可用设置已经就绪，但还没有打开配置文件。", "Available settings are ready, but no configuration file is open yet."),
    };
  }
  if (session.readOnly) {
    return {
      ...base,
      state: "attention",
      title: textForLocale(locale, "配置已打开，但当前只能查看", "Configuration opened as read-only"),
      description: textForLocale(locale, "仍可搜索和预览；选择通过安全检查的写入位置后即可编辑。", "You can still search and preview. Choose a writable location that passes safety checks to edit."),
    };
  }
  if (warnings > 0) {
    return {
      ...base,
      state: "attention",
      title: textForLocale(locale, "工作区可用，有几项信息值得确认", "Workspace ready with a few notices"),
      description: textForLocale(locale, "编辑仍可继续；保存前请查看兼容性与配置来源提示。", "Editing can continue. Review compatibility and source notices before saving."),
    };
  }
  return {
    ...base,
    state: "ready",
    title: textForLocale(locale, "工作区准备就绪", "Workspace ready"),
    description: textForLocale(locale, "先在草稿中调整，确认预览与差异后再保存。", "Adjust the draft, review the preview and diff, then save."),
  };
}

export function createCompatibilitySnapshot(schema: RuntimeSchema): CompatibilitySnapshot {
  const optionFingerprints = Object.fromEntries(
    schema.options.map((option) => [option.key, optionFingerprint(option)]),
  );
  return {
    version: 1,
    ghosttyVersion: schema.ghosttyVersion,
    schemaHash: schema.schemaHash,
    optionKeys: [...new Set(schema.options.map((option) => option.key))].sort(),
    optionFingerprints,
  };
}

function optionFingerprint(option: RuntimeOption): string {
  const contract = JSON.stringify([
    option.kind,
    option.choices,
    option.defaultValues,
    option.repeatable,
    option.platform,
    option.since,
    option.risk,
    option.editable,
    option.capability,
  ]);
  // This is a compact change detector, not a security or integrity primitive.
  let hash = 0x811c9dc5;
  for (let index = 0; index < contract.length; index += 1) {
    hash ^= contract.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function compareCompatibility(
  previous: CompatibilitySnapshot | null,
  current: CompatibilitySnapshot,
): CompatibilityChange | null {
  if (!previous) return null;
  const previousKeys = new Set(previous.optionKeys);
  const currentKeys = new Set(current.optionKeys);
  const addedKeys = current.optionKeys.filter((key) => !previousKeys.has(key));
  const removedKeys = previous.optionKeys.filter((key) => !currentKeys.has(key));
  const changedKeys = current.optionKeys.filter((key) => (
    previousKeys.has(key)
    && previous.optionFingerprints[key] !== current.optionFingerprints[key]
  ));
  const schemaChanged = previous.schemaHash !== current.schemaHash;
  if (
    !schemaChanged
    && previous.ghosttyVersion === current.ghosttyVersion
    && addedKeys.length === 0
    && removedKeys.length === 0
    && changedKeys.length === 0
  ) {
    return null;
  }
  return {
    previousVersion: previous.ghosttyVersion,
    currentVersion: current.ghosttyVersion,
    addedKeys,
    removedKeys,
    changedKeys,
    schemaChanged,
  };
}

export function loadCompatibilitySnapshot(storage: StorageLike): CompatibilitySnapshot | null {
  try {
    const raw = storage.getItem(COMPATIBILITY_STORAGE_KEY);
    if (!raw || raw.length > MAX_STORED_SNAPSHOT_BYTES) return null;
    const parsed = JSON.parse(raw) as Partial<CompatibilitySnapshot>;
    if (
      parsed.version !== 1
      || (parsed.ghosttyVersion !== null && typeof parsed.ghosttyVersion !== "string")
      || typeof parsed.schemaHash !== "string"
      || parsed.schemaHash.length > 256
      || !Array.isArray(parsed.optionKeys)
      || parsed.optionKeys.length > MAX_OPTION_KEYS
      || parsed.optionKeys.some((key) => (
        typeof key !== "string"
        || key.length > MAX_KEY_LENGTH
        || !/^[a-z0-9-]+$/.test(key)
      ))
      || !parsed.optionFingerprints
      || typeof parsed.optionFingerprints !== "object"
      || Array.isArray(parsed.optionFingerprints)
    ) {
      return null;
    }
    const optionFingerprints = parsed.optionFingerprints as Record<string, unknown>;
    const fingerprintEntries = Object.entries(optionFingerprints);
    const uniqueKeys = new Set(parsed.optionKeys);
    if (
      fingerprintEntries.length > MAX_OPTION_KEYS
      || fingerprintEntries.length !== uniqueKeys.size
      || [...uniqueKeys].some((key) => !Object.hasOwn(optionFingerprints, key))
      || fingerprintEntries.some(([key, fingerprint]) => (
        key.length > MAX_KEY_LENGTH
        || !parsed.optionKeys?.includes(key)
        || typeof fingerprint !== "string"
        || !/^[0-9a-f]{8}$/.test(fingerprint)
      ))
    ) return null;
    return {
      version: 1,
      ghosttyVersion: parsed.ghosttyVersion ?? null,
      schemaHash: parsed.schemaHash,
      optionKeys: [...new Set(parsed.optionKeys)].sort(),
      optionFingerprints: Object.fromEntries(fingerprintEntries) as Record<string, string>,
    };
  } catch {
    return null;
  }
}

export function saveCompatibilitySnapshot(
  storage: StorageLike,
  snapshot: CompatibilitySnapshot,
): boolean {
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_STORED_SNAPSHOT_BYTES) return false;
    storage.setItem(COMPATIBILITY_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
