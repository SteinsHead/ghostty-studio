export type SettingKind =
  | "boolean"
  | "integer"
  | "number"
  | "color"
  | "select"
  | "duration"
  | "text";

export type SettingEditMode = "control" | "raw" | "none";

export type SettingActivation =
  | "reload"
  | "reload-new-terminal"
  | "restart"
  | "unknown";

export type SettingRestriction =
  | "version-not-supported"
  | "setting-changed"
  | "needs-list-editor"
  | "needs-theme-picker"
  | "protected"
  | "advanced-setting"
  | "platform-unavailable"
  | "needs-editor"
  | "unrecognized-setting"
  | null;

export interface SettingCapability {
  editMode: SettingEditMode;
  reason: SettingRestriction;
  activation: SettingActivation;
  constraintBehavior: "reject" | "clamp" | "warn" | "ignore" | "unknown";
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  platform: string | null;
}

export interface GhosttyProbe {
  available: boolean;
  version: string | null;
  channel: string | null;
}

export interface ConfigCandidate {
  id: string;
  label: string;
  source: "xdg" | "macos" | "include" | "custom";
  format: "legacy" | "ghostty";
  priority: number;
  exists: boolean;
  writable: boolean;
  symlink: boolean;
  sizeBytes: number | null;
  creationEligible: boolean;
}

export interface SettingEffect {
  status: "effective" | "overridden" | "inherited" | "unverified";
  sourceCandidateId: string | null;
  sourceLabel: string | null;
}

export interface EnvironmentReport {
  platform: string;
  architecture: string;
  ghostty: GhosttyProbe;
  candidates: ConfigCandidate[];
  warnings: string[];
}

export interface RuntimeOption {
  key: string;
  description: string;
  defaultValues: string[];
  currentValues: string[];
  category: string;
  kind: SettingKind;
  choices: string[];
  repeatable: boolean;
  platform: string | null;
  since: string | null;
  risk: "normal" | "sensitive" | "advanced";
  editable: boolean;
  capability: SettingCapability;
}

export interface RuntimeSchema {
  ghosttyVersion: string | null;
  schemaHash: string;
  options: RuntimeOption[];
  diagnostics: string[];
}

export interface ConfigSession {
  id: string;
  candidateId: string;
  revision: string;
  readOnly: boolean;
  values: Record<string, string[]>;
  configuredSettings: ConfiguredSetting[];
  unrecognizedSettingCount: number;
  diagnostics: string[];
  backgroundImage: BackgroundImageState;
  effectiveValuesKnown: boolean;
  effectiveValues: Record<string, string[]>;
  effectiveBackgroundImage: BackgroundImageState;
  settingEffects: Record<string, SettingEffect>;
}

export interface BackgroundImageState {
  kind: "none" | "managed" | "external";
  assetId: string | null;
}

export interface BackgroundAssetSummary {
  id: string;
  displayName: string;
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  importedAtMs: number;
  largeImageWarning: boolean;
  usage: BackgroundAssetUsage;
}

export interface BackgroundAssetReference {
  candidateId: string | null;
  sourceLabel: string | null;
  writable: boolean;
}

export interface BackgroundAssetUsage {
  status: "available" | "referenced" | "unknown";
  references: BackgroundAssetReference[];
}

export interface BackgroundPreviewState {
  status: "idle" | "loading" | "ready" | "error";
  dataUrl: string | null;
}

export interface BackgroundAssetPreview {
  assetId: string;
  dataUrl: string;
}

export interface BackgroundAssetImportFailure {
  displayName: string;
  code: string;
}

export interface BackgroundAssetImportResult {
  canceled: boolean;
  assets: BackgroundAssetSummary[];
  rejected: BackgroundAssetImportFailure[];
}

export interface ConfiguredSetting {
  key: string;
  occurrenceCount: number;
  valueExposure: "available" | "protected";
}

export interface ConfigNode {
  id: string;
  path: string;
  loadIndex: number;
  depth: number;
  assignmentCount: number;
  symlink: boolean;
}

export interface ConfigEdge {
  fromId: string;
  toId: string | null;
  declaredPath: string;
  line: number;
  optional: boolean;
  status: string;
}

export interface ProvenanceEntry {
  key: string;
  sourceId: string;
  sourcePath: string;
  line: number;
  loadIndex: number;
}

export interface GraphDiagnostic {
  code: string;
  message: string;
  path: string | null;
  line: number | null;
}

export interface ConfigGraph {
  graphRevision: string;
  complete: boolean;
  semanticsKnown: boolean;
  nodes: ConfigNode[];
  edges: ConfigEdge[];
  provenance: ProvenanceEntry[];
  diagnostics: GraphDiagnostic[];
  totalBytes: number;
}

export interface DraftChange {
  key: string;
  before: string[];
  after: string[];
}

export interface ChangePreview {
  token: string;
  revision: string;
  changes: DraftChange[];
  unifiedDiff: string;
  diagnostics: string[];
  valid: boolean;
  activation: SettingActivation;
  effect: ChangeEffectPreview;
}

export interface ChangeEffectPreview {
  status: "effective" | "overridden" | "unverified";
  affectedKeys: string[];
  suggestedCandidateId: string | null;
  suggestedLabel: string | null;
}

export interface ApplyResult {
  revision: string;
  snapshotId: string;
  diagnostics: string[];
  warnings: string[];
  reloadRequired: boolean;
  activation: SettingActivation;
  effectiveStatus: "verified" | "resolved" | "unverified";
}

export interface SnapshotInfo {
  id: string;
  createdAtMs: number;
  revision: string;
  sizeBytes: number;
}

export interface Backend {
  probeEnvironment(): Promise<EnvironmentReport>;
  loadRuntimeSchema(): Promise<RuntimeSchema>;
  loadConfigGraph(): Promise<ConfigGraph>;
  openConfig(candidateId: string): Promise<ConfigSession>;
  createConfig(candidateId: string, locale?: "zh-CN" | "en"): Promise<ConfigSession>;
  stageChanges(
    sessionId: string,
    revision: string,
    changes: DraftChange[],
  ): Promise<ChangePreview>;
  applyChanges(
    sessionId: string,
    revision: string,
    token: string,
    locale?: "zh-CN" | "en",
  ): Promise<ApplyResult>;
  listSnapshots(sessionId: string): Promise<SnapshotInfo[]>;
  restoreSnapshot(
    sessionId: string,
    revision: string,
    snapshotId: string,
    locale?: "zh-CN" | "en",
  ): Promise<ApplyResult>;
  listBackgroundAssets(): Promise<BackgroundAssetSummary[]>;
  chooseBackgroundImages(): Promise<BackgroundAssetImportResult>;
  getBackgroundAssetPreview(assetId: string): Promise<BackgroundAssetPreview>;
  deleteBackgroundAsset(assetId: string, locale?: "zh-CN" | "en"): Promise<void>;
}
