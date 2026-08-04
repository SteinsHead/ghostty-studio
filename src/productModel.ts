import type {
  ConfigGraph,
  ConfigSession,
  EnvironmentReport,
  RuntimeOption,
  RuntimeSchema,
} from "./types";

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
  return option.editable !== false
    && !option.repeatable
    && option.risk === "normal";
}

export function deriveWorkspaceSummary(
  environment: EnvironmentReport | null,
  schema: RuntimeSchema | null,
  session: ConfigSession | null,
  graph: ConfigGraph | null,
  desktop: boolean,
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
      title: "先体验，再决定是否接入本机配置",
      description: "当前是安全演示模式。你可以探索交互，但不会读取或写入本机文件。",
    };
  }
  if (!environment?.ghostty.available) {
    return {
      ...base,
      state: "blocked",
      title: "还没有找到 Ghostty",
      description: "安装或重新打开 Ghostty 后重新检查；在此之前，配置保持只读。",
    };
  }
  if (!schema || options.length === 0) {
    return {
      ...base,
      state: "blocked",
      title: "无法读取当前 Ghostty 的设置目录",
      description: "Ghostty Studio 没有猜测未知设置，编辑已安全暂停。",
    };
  }
  if (existingConfigCount === 0 || !session) {
    return {
      ...base,
      state: "attention",
      title: "选择一个配置文件后开始",
      description: "设置目录已经就绪，但还没有打开可编辑的配置层。",
    };
  }
  if (session.readOnly) {
    return {
      ...base,
      state: "attention",
      title: "配置已打开，但当前只能查看",
      description: "你仍然可以搜索和预览；写入会保持禁用，直到目标通过安全检查。",
    };
  }
  if (warnings > 0) {
    return {
      ...base,
      state: "attention",
      title: "工作区可用，有几项信息值得确认",
      description: "编辑仍可继续；保存前请查看兼容性与配置来源提示。",
    };
  }
  return {
    ...base,
    state: "ready",
    title: "工作区准备就绪",
    description: "先在草稿中调整设置，确认预览与差异后再保存。",
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
    option.editable ?? null,
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
