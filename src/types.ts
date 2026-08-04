export type SettingKind =
  | "boolean"
  | "integer"
  | "number"
  | "color"
  | "select"
  | "duration"
  | "text";

export interface GhosttyProbe {
  available: boolean;
  executablePath: string | null;
  version: string | null;
  channel: string | null;
  rawVersion: string | null;
}

export interface ConfigCandidate {
  id: string;
  label: string;
  path: string;
  source: "xdg" | "macos" | "custom";
  format: "legacy" | "ghostty";
  priority: number;
  exists: boolean;
  writable: boolean;
  symlink: boolean;
  sizeBytes: number | null;
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
  editable?: boolean;
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
  path: string;
  revision: string;
  readOnly: boolean;
  values: Record<string, string[]>;
  diagnostics: string[];
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
}

export interface ApplyResult {
  revision: string;
  snapshotId: string;
  diagnostics: string[];
  warnings: string[];
  reloadRequired: boolean;
}

export interface SnapshotInfo {
  id: string;
  createdAtMs: number;
  revision: string;
  sizeBytes: number;
}

export interface ExtensionInspection {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  settingCount: number;
  presetCount: number;
  migrationCount: number;
  trusted: boolean;
}

export interface Backend {
  probeEnvironment(): Promise<EnvironmentReport>;
  loadRuntimeSchema(): Promise<RuntimeSchema>;
  loadConfigGraph(): Promise<ConfigGraph>;
  inspectExtensionManifest(manifest: string): Promise<ExtensionInspection>;
  openConfig(candidateId: string): Promise<ConfigSession>;
  createConfig(candidateId: string): Promise<ConfigSession>;
  stageChanges(
    sessionId: string,
    revision: string,
    changes: DraftChange[],
  ): Promise<ChangePreview>;
  applyChanges(
    sessionId: string,
    revision: string,
    token: string,
  ): Promise<ApplyResult>;
  listSnapshots(sessionId: string): Promise<SnapshotInfo[]>;
  restoreSnapshot(
    sessionId: string,
    revision: string,
    snapshotId: string,
  ): Promise<ApplyResult>;
}
